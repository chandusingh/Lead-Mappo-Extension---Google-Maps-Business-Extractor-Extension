// Lead Mappo GMap Extractor - Content Script
// Extracts: Business Name, Phone, Website, Address, City, State, Postal Code, 
// Country, Latitude, Longitude, Rating, Reviews, Place URL, Place ID, Keyword, Location

if (typeof window.ashaGmapLoaded === 'undefined') {
    window.ashaGmapLoaded = true;
    
    let isScanning = false;
    let extractedPlaceIds = new Set();
    let scrollCount = 0;
    let noNewItemsCount = 0;
    const MAX_SCROLLS = 100;
    let scrollLoopActive = false;
    let scrollPaused = false;

    // Initialize
    (async function init() {
        console.log('[Asha GMap] Content script loaded');
        const { scanStatus } = await chrome.storage.local.get('scanStatus');
        if (scanStatus === 'running') {
            isScanning = true;
            waitForResults();
        }
    })();

    // Message listener
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'STOP_SCAN') {
            isScanning = false;
            scrollLoopActive = false;
            console.log('[Asha GMap] Scan stopped');
        } else if (message.type === 'RESUME_SCROLL') {
            // Resume scrolling if it was paused (e.g., due to tab becoming inactive)
            if (isScanning && !scrollLoopActive) {
                console.log('[Asha GMap] Resuming scroll from background nudge...');
                scrollLoopActive = true;
                extractAndScroll();
            }
        }
    });

    // Storage listener
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.scanStatus?.newValue === 'stopped') {
            isScanning = false;
            scrollLoopActive = false;
        } else if (changes.scanStatus?.newValue === 'running') {
            isScanning = true;
            extractedPlaceIds.clear();
            scrollCount = 0;
            noNewItemsCount = 0;
            scrollLoopActive = false;
            waitForResults();
        }
    });

    // Send heartbeat to background to indicate scroll is still active
    function sendHeartbeat() {
        if (isScanning && scrollLoopActive) {
            chrome.runtime.sendMessage({ type: 'SCROLL_HEARTBEAT' });
        }
    }

    function waitForResults() {
        let attempts = 0;
        const checkInterval = setInterval(() => {
            attempts++;
            // Multiple selectors to find business cards
            const cards = findBusinessCards();
            
            if (cards.length > 0) {
                clearInterval(checkInterval);
                console.log('[Asha GMap] Results found:', cards.length, 'cards. Starting extraction...');
                scrollLoopActive = true;
                setTimeout(extractAndScroll, 2000);
            } else if (attempts > 30) {
                clearInterval(checkInterval);
                console.log('[Asha GMap] Timeout - no results found');
                scrollLoopActive = false;
                chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE' });
            }
        }, 500);
    }

    function findBusinessCards() {
        // Multiple selector strategies - Google changes class names frequently
        const selectors = [
            '.Nv2PK',                    // Standard business card
            'div[role="article"]',       // Article-based layout
            '.bfdHYd',                   // Alternative card class
            'a[href*="/maps/place/"]',   // Links to place pages
            '[data-result-index]',       // Indexed results
            '.lI9IFe',                   // Another card variant
            '.THOPZb'                    // Grid view cards
        ];
        
        for (const selector of selectors) {
            const cards = document.querySelectorAll(selector);
            if (cards.length > 0) {
                console.log('[Asha GMap] Found cards with selector:', selector);
                return cards;
            }
        }
        return [];
    }

    function extractAndScroll() {
        if (!isScanning) {
            scrollLoopActive = false;
            chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE' });
            return;
        }

        // Send heartbeat to background to indicate we're still active
        sendHeartbeat();

        const results = extractBusinessData();
        const prevCount = extractedPlaceIds.size;
        
        if (results.length > 0) {
            const newResults = results.filter(r => {
                if (!r.place_id || extractedPlaceIds.has(r.place_id)) return false;
                extractedPlaceIds.add(r.place_id);
                return true;
            });
            
            if (newResults.length > 0) {
                chrome.storage.local.get(['currentKeyword', 'currentLocation'], (data) => {
                    newResults.forEach(r => {
                        r.search_keyword = data.currentKeyword || '';
                        r.search_location = data.currentLocation || '';
                    });
                    console.log('[Asha GMap] Sending', newResults.length, 'new results. Total:', extractedPlaceIds.size);
                    chrome.runtime.sendMessage({ type: 'DATA_EXTRACTED', data: newResults });
                });
            }
        }

        scrollCount++;
        const newItemsFound = extractedPlaceIds.size > prevCount;
        console.log('[Asha GMap] Scroll:', scrollCount, '/', MAX_SCROLLS, '| Total items:', extractedPlaceIds.size, '| New items this round:', newItemsFound);
        
        // Check if we should stop
        if (endOfListReached()) {
            console.log('[Asha GMap] End of list reached - scan complete');
            scrollLoopActive = false;
            chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE' });
            return;
        }
        
        if (scrollCount >= MAX_SCROLLS) {
            console.log('[Asha GMap] Max scrolls reached - scan complete');
            scrollLoopActive = false;
            chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE' });
            return;
        }
        
        // If no new items found for 5 consecutive scrolls, stop
        if (!newItemsFound) {
            noNewItemsCount++;
            if (noNewItemsCount >= 5) {
                console.log('[Asha GMap] No new items for 5 scrolls - scan complete');
                scrollLoopActive = false;
                chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE' });
                return;
            }
        } else {
            noNewItemsCount = 0;
        }

        // Scroll for more results
        scrollForMore();
        
        // Variable delay to allow page to load new content
        const delay = 2000 + Math.random() * 1500;
        setTimeout(extractAndScroll, delay);
    }

    function extractBusinessData() {
        const results = [];
        const cards = findBusinessCards();
        
        console.log('[Lead Mappo] Extracting from', cards.length, 'business cards');
        
        cards.forEach((card, index) => {
            try {
                const result = {
                    business_name: '',
                    phone: '',
                    phone_2: '',
                    phone_3: '',
                    website: '',
                    website_2: '',
                    email: '',
                    email_2: '',
                    full_address: '',
                    address: '',
                    city: '',
                    state: '',
                    postal_code: '',
                    country: '',
                    latitude: '',
                    longitude: '',
                    average_rating: '',
                    total_reviews: '',
                    place_url: '',
                    place_id: '',
                    category: '',
                    search_keyword: '',
                    search_location: ''
                };
                
                // === BUSINESS NAME ===
                const nameSelectors = [
                    '.qBF1Pd', '.fontHeadlineSmall', '.NrDZNb', '.dbg0pd',
                    '[class*="fontTitle"]', '[class*="headline"]', 'a.hfpxzc',
                ];
                
                for (const sel of nameSelectors) {
                    const el = card.querySelector(sel);
                    if (el) {
                        let name = el.getAttribute('aria-label') || el.textContent?.trim();
                        if (name && name.length > 1 && name.length < 200) {
                            result.business_name = name;
                            break;
                        }
                    }
                }
                
                // Fallback - main link aria-label
                if (!result.business_name) {
                    const mainLink = card.querySelector('a[href*="maps/place"]') || 
                                   card.querySelector('a[data-item-id]') ||
                                   card.querySelector('a.hfpxzc');
                    if (mainLink) {
                        const ariaLabel = mainLink.getAttribute('aria-label');
                        if (ariaLabel) {
                            result.business_name = ariaLabel;
                        }
                    }
                }
                
                // Skip if no business name found
                if (!result.business_name) {
                    return;
                }
                
                // === PLACE URL & PLACE ID ===
                const placeLink = card.querySelector('a[href*="/maps/place/"]') ||
                                 card.querySelector('a.hfpxzc') ||
                                 card.querySelector('a[data-item-id]');
                
                if (placeLink) {
                    const href = placeLink.getAttribute('href') || '';
                    result.place_url = href.startsWith('http') ? href : 
                                       href.startsWith('/') ? `https://www.google.com${href}` : '';
                    
                    // Extract Place ID
                    const cidMatch = href.match(/0x[\da-f]+:0x([\da-f]+)/i);
                    if (cidMatch) {
                        result.place_id = hexToDec(cidMatch[1]);
                    } else {
                        const ftidMatch = href.match(/ftid=([\w:]+)/);
                        if (ftidMatch) {
                            result.place_id = ftidMatch[1];
                        } else {
                            result.place_id = `gen_${Date.now()}_${index}`;
                        }
                    }
                    
                    // Extract coordinates
                    const coordPatterns = [
                        /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,
                        /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
                        /ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/
                    ];
                    
                    for (const pattern of coordPatterns) {
                        const match = href.match(pattern);
                        if (match) {
                            result.latitude = match[1];
                            result.longitude = match[2];
                            break;
                        }
                    }
                }
                
                // === RATING & REVIEWS ===
                const ratingSelectors = ['.MW4etd', '.e4rVHe', '.ZkP5Je', '.yi40Hd', '.fzTgPe'];
                for (const sel of ratingSelectors) {
                    const el = card.querySelector(sel);
                    if (el) {
                        const text = el.textContent?.trim();
                        if (text && /^\d+\.?\d*$/.test(text)) {
                            result.average_rating = text;
                            break;
                        }
                    }
                }
                
                // Rating from aria-label
                if (!result.average_rating) {
                    const starEl = card.querySelector('[aria-label*="star"], [aria-label*="rating"]');
                    if (starEl) {
                        const ariaLabel = starEl.getAttribute('aria-label');
                        const ratingMatch = ariaLabel?.match(/(\d+\.?\d*)\s*star/i);
                        if (ratingMatch) {
                            result.average_rating = ratingMatch[1];
                        }
                    }
                }
                
                // Reviews count
                const reviewSelectors = ['.UY7F9', '.HypWnf', '.e4rVHe', '.RDApEe'];
                for (const sel of reviewSelectors) {
                    const el = card.querySelector(sel);
                    if (el) {
                        const text = el.textContent || '';
                        const match = text.match(/\(?([\d,]+)\)?(\s*reviews?)?/i);
                        if (match) {
                            result.total_reviews = match[1].replace(/,/g, '');
                            break;
                        }
                    }
                }
                
                // === COLLECT ALL TEXT CONTENT ===
                const allTexts = [];
                const phones = [];
                const emails = [];
                const websites = [];
                const addressParts = [];
                
                // Get all info containers
                const infoSelectors = ['.W4Efsd', '.lI9IFe', '.UaQhfb', '.rogA2c', '.Io6YTe', '.fontBodyMedium'];
                
                for (const sel of infoSelectors) {
                    card.querySelectorAll(sel).forEach(container => {
                        const spans = container.querySelectorAll('span, [role="text"]');
                        spans.forEach(node => {
                            const text = node.textContent?.trim();
                            if (text && text !== '·' && text.length > 1 && text.length < 300) {
                                if (!allTexts.includes(text)) {
                                    allTexts.push(text);
                                }
                            }
                        });
                    });
                }
                
                // Also get all links for websites
                card.querySelectorAll('a[href]').forEach(link => {
                    const href = link.getAttribute('href') || '';
                    // Skip Google links
                    if (href && href.startsWith('http') && !href.includes('google.com') && !href.includes('gstatic.com')) {
                        if (!websites.includes(href)) {
                            websites.push(href);
                        }
                    }
                });
                
                // === PARSE ALL TEXTS ===
                let categoryFound = false;
                
                const categoryKeywords = [
                    'restaurant', 'hotel', 'hospital', 'clinic', 'school', 'college',
                    'shop', 'store', 'market', 'bank', 'office', 'salon', 'spa',
                    'gym', 'fitness', 'cafe', 'bar', 'pub', 'pharmacy', 'medical',
                    'dental', 'doctor', 'lawyer', 'consultant', 'agency', 'studio',
                    'institute', 'academy', 'center', 'centre', 'service', 'repair',
                    'electronics', 'mobile', 'computer', 'software', 'coaching',
                    'tuition', 'classes', 'training', 'builder', 'contractor', 'pvt',
                    'ltd', 'private', 'limited', 'inc', 'corp', 'llc'
                ];
                
                for (const text of allTexts) {
                    if (text === '·' || text.length < 2) continue;
                    
                    // === PHONE NUMBER DETECTION ===
                    // Match various phone formats
                    const phonePatterns = [
                        /(?:\+91[\s\-]?)?[6-9]\d{9}/g,           // Indian mobile
                        /(?:\+91[\s\-]?)?\d{3,4}[\s\-]?\d{3}[\s\-]?\d{4}/g,  // Indian landline
                        /(?:\+1[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/g, // US
                        /(?:\+\d{1,3}[\s\-]?)?\d{6,15}/g         // International
                    ];
                    
                    for (const pattern of phonePatterns) {
                        const matches = text.match(pattern);
                        if (matches) {
                            matches.forEach(phone => {
                                const cleanPhone = phone.replace(/[^\d+]/g, '');
                                if (cleanPhone.length >= 7 && cleanPhone.length <= 15) {
                                    if (!phones.includes(phone) && !phones.some(p => p.replace(/[^\d]/g, '') === cleanPhone)) {
                                        phones.push(phone.trim());
                                    }
                                }
                            });
                        }
                    }
                    
                    // === EMAIL DETECTION ===
                    const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
                    const emailMatches = text.match(emailPattern);
                    if (emailMatches) {
                        emailMatches.forEach(email => {
                            if (!emails.includes(email.toLowerCase())) {
                                emails.push(email.toLowerCase());
                            }
                        });
                    }
                    
                    // Skip opening hours
                    if (/^(open|closed|hours|24 hours|open now|closes|opens)/i.test(text.toLowerCase())) continue;
                    
                    // Skip if it's just a rating
                    if (/^\d+\.?\d*$/.test(text)) continue;
                    
                    // === CATEGORY DETECTION ===
                    if (!categoryFound && text.length < 60 && !text.includes(',')) {
                        const isCategory = categoryKeywords.some(kw => 
                            text.toLowerCase().includes(kw)
                        );
                        
                        if (isCategory || (text.length < 40 && !/\d{4,}/.test(text) && !/\d+[,\s]+\d+/.test(text))) {
                            // Check if it looks like a category (not an address)
                            if (!/\d{3,}/.test(text) && !/(road|street|floor|block|sector|nagar|colony|plot)/i.test(text)) {
                                result.category = text;
                                categoryFound = true;
                                continue;
                            }
                        }
                    }
                    
                    // === ADDRESS DETECTION ===
                    const isAddressLike = 
                        text.includes(',') || 
                        /\d+/.test(text) ||
                        /(road|rd|street|st|colony|nagar|block|sector|floor|plot|apartment|apt|building|bldg|no\.|house|shop|office|tower|complex|mall|market)/i.test(text);
                    
                    if (isAddressLike && text.length > 5) {
                        // Avoid duplicates and phone-only strings
                        const strippedText = text.replace(/[+\-\(\)\s]/g, '');
                        if (!/^\d{7,15}$/.test(strippedText) && !addressParts.includes(text)) {
                            addressParts.push(text);
                        }
                    }
                }
                
                // === ASSIGN PHONES ===
                if (phones.length > 0) result.phone = phones[0];
                if (phones.length > 1) result.phone_2 = phones[1];
                if (phones.length > 2) result.phone_3 = phones[2];
                
                // === ASSIGN EMAILS ===
                if (emails.length > 0) result.email = emails[0];
                if (emails.length > 1) result.email_2 = emails[1];
                
                // === ASSIGN WEBSITES ===
                if (websites.length > 0) result.website = websites[0];
                if (websites.length > 1) result.website_2 = websites[1];
                
                // === BUILD FULL ADDRESS ===
                result.full_address = addressParts.join(', ')
                    .replace(/\s+/g, ' ')
                    .replace(/,\s*,/g, ',')
                    .replace(/(^,\s*|\s*,$)/g, '')
                    .trim();
                
                // Remove category from address if it's at the start
                if (result.category && result.full_address.toLowerCase().startsWith(result.category.toLowerCase())) {
                    result.full_address = result.full_address.substring(result.category.length)
                        .replace(/^[\s·,]+/, '').trim();
                }
                
                // === PARSE ADDRESS COMPONENTS ===
                if (result.full_address) {
                    parseAddressComponents(result);
                }
                
                // Try to detect country
                if (!result.country) {
                    result.country = detectCountry(result.full_address);
                }
                
                results.push(result);
                console.log('[Asha GMap] Extracted:', result.business_name, 
                    '| Phones:', phones.length, 
                    '| Emails:', emails.length,
                    '| Websites:', websites.length);
                
            } catch (e) {
                console.error('[Asha GMap] Error parsing card:', e);
            }
        });
        
        return results;
    }
    
    function parseAddressComponents(result) {
        const address = result.full_address;
        
        // Extract postal code patterns
        const postalPatterns = [
            /\b(\d{6})\b/,                    // India (6 digits)
            /\b(\d{5}(?:-\d{4})?)\b/,         // US (5 or 5+4 digits)
            /\b([A-Z]\d[A-Z]\s?\d[A-Z]\d)\b/i, // Canada
            /\b([A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2})\b/i, // UK
        ];
        
        for (const pattern of postalPatterns) {
            const match = address.match(pattern);
            if (match) {
                result.postal_code = match[1].toUpperCase();
                break;
            }
        }
        
        // Split by comma and parse
        const parts = address.split(',').map(p => p.trim()).filter(p => p.length > 0);
        
        // Indian states for better detection
        const indianStates = [
            'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
            'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
            'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
            'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
            'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
            'Delhi', 'Chandigarh', 'Puducherry', 'Ladakh', 'J&K', 'Jammu', 'Kashmir',
            'MP', 'UP', 'AP', 'TN', 'WB', 'MH', 'KA', 'RJ', 'GJ', 'HR', 'PB', 'HP'
        ];
        
        // Known countries
        const countries = [
            'India', 'USA', 'United States', 'UK', 'United Kingdom', 
            'Canada', 'Australia', 'Germany', 'France', 'Japan', 
            'China', 'Brazil', 'Mexico', 'Spain', 'Italy', 'Singapore',
            'UAE', 'Dubai', 'Saudi Arabia', 'Nepal', 'Bangladesh', 'Pakistan'
        ];
        
        if (parts.length >= 1) {
            // Check each part from the end
            for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i].replace(/\d+/g, '').trim();
                
                // Check if it's a country
                if (!result.country) {
                    const isCountry = countries.some(c => 
                        part.toLowerCase().includes(c.toLowerCase()) ||
                        part.toLowerCase() === c.toLowerCase()
                    );
                    if (isCountry) {
                        result.country = part;
                        continue;
                    }
                }
                
                // Check if it's a state
                if (!result.state) {
                    const isState = indianStates.some(s => 
                        part.toLowerCase().includes(s.toLowerCase()) ||
                        part.toLowerCase() === s.toLowerCase()
                    );
                    if (isState || (part.length <= 25 && !part.includes(' ') && i >= parts.length - 3)) {
                        result.state = part;
                        continue;
                    }
                }
                
                // City is usually before state/country
                if (!result.city && result.state && i < parts.length - 1) {
                    result.city = parts[i].replace(/\d{6}/g, '').trim();
                    break;
                }
            }
        }
        
        // Build street address (everything except city, state, country, postal)
        const addressExclusions = [result.city, result.state, result.country, result.postal_code].filter(Boolean);
        const streetParts = parts.filter(part => {
            const cleanPart = part.replace(/\d{6}/g, '').trim();
            return !addressExclusions.some(ex => 
                cleanPart.toLowerCase().includes(ex.toLowerCase()) ||
                ex.toLowerCase().includes(cleanPart.toLowerCase())
            );
        });
        
        result.address = streetParts.join(', ').trim();
        
        // Clean state - remove postal code
        if (result.state && result.postal_code) {
            result.state = result.state.replace(result.postal_code, '').trim();
        }
        
        // Set country to India if we detected Indian state
        if (!result.country && result.state) {
            const isIndianState = indianStates.some(s => 
                result.state.toLowerCase().includes(s.toLowerCase())
            );
            if (isIndianState) {
                result.country = 'India';
            }
        }
    }
    
    function detectCountry(address) {
        if (!address) return '';
        
        const countryPatterns = {
            'India': /india|bharat|\bIN\b/i,
            'United States': /usa|united states|america|\bUS\b/i,
            'United Kingdom': /uk|united kingdom|england|britain|\bGB\b/i,
            'Canada': /canada|\bCA\b/i,
            'Australia': /australia|\bAU\b/i,
            'Germany': /germany|deutschland|\bDE\b/i,
            'France': /france|\bFR\b/i,
            'Japan': /japan|nippon|\bJP\b/i,
            'China': /china|zhongguo|\bCN\b/i,
        };
        
        for (const [country, pattern] of Object.entries(countryPatterns)) {
            if (pattern.test(address)) {
                return country;
            }
        }
        
        // Detect from current page URL
        const url = window.location.href;
        if (url.includes('.co.in') || url.includes('/IN/')) return 'India';
        if (url.includes('/US/')) return 'United States';
        if (url.includes('.co.uk') || url.includes('/GB/')) return 'United Kingdom';
        
        return '';
    }

    function scrollForMore() {
        const scrollContainers = [
            document.querySelector('[role="feed"]'),
            document.querySelector('.m6QErb.DxyBCb.XiKgde'),
            document.querySelector('.m6QErb.DxyBCb'),
            document.querySelector('.m6QErb.XiKgde'),
            document.querySelector('.m6QErb'),
            document.querySelector('[aria-label*="Results"]'),
            document.querySelector('.section-layout.section-scrollbox')
        ];
        
        let scrolled = false;
        for (const container of scrollContainers) {
            if (container && container.scrollHeight > container.clientHeight) {
                const prevScrollTop = container.scrollTop;
                container.scrollTop = container.scrollHeight;
                container.scrollBy({ top: 500, behavior: 'smooth' });
                
                if (container.scrollTop !== prevScrollTop) {
                    scrolled = true;
                    console.log('[Asha GMap] Scrolled container');
                    return;
                }
            }
        }
        
        // Fallback - scroll last card into view
        if (!scrolled) {
            const cards = findBusinessCards();
            if (cards.length > 0) {
                cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
                console.log('[Asha GMap] Used scrollIntoView fallback');
            }
        }
    }

    function endOfListReached() {
        const endIndicators = [
            '.HlvSq',              // End of list message
            '.TIHn2',              // Single business view
            '.section-no-result'   // No results
        ];
        
        for (const sel of endIndicators) {
            if (document.querySelector(sel)) return true;
        }
        
        // Check for end text
        const pageText = document.body.innerText;
        if (pageText.includes("You've reached the end") || 
            pageText.includes("No more results")) {
            return true;
        }
        
        return false;
    }

    function hexToDec(hex) {
        try {
            return BigInt('0x' + hex).toString();
        } catch (e) {
            return hex;
        }
    }
}
