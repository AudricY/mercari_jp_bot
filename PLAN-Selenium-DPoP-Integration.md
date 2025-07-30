# Plan: Selenium DPoP Token Extraction & API Integration

## Purpose & Scope
Enhance the Mercari bot to extract DPoP tokens using Selenium and use them for direct API calls to `https://api.mercari.jp/v2/entities:search`. This will provide faster, more reliable item fetching compared to web scraping while maintaining the same functionality.

## Key Benefits
- **Performance**: API calls are faster than DOM scraping
- **Reliability**: Less prone to UI changes and layout shifts
- **Efficiency**: Reduced bandwidth and processing overhead
- **Scalability**: Easier to handle rate limiting and pagination

## Architecture Overview
1. **DPoP Token Extraction**: Use Selenium to intercept network requests and extract DPoP headers
2. **Token Management**: Cache and refresh tokens as needed
3. **API Client**: New module for making authenticated API requests
4. **Hybrid Approach**: Fall back to web scraping if API fails

## Key Files to Modify/Create
1. `src/mercari_bot/dpop_extractor.py` - New: DPoP token extraction using Selenium
2. `src/mercari_bot/api_client.py` - New: Mercari API client with DPoP authentication
3. `src/mercari_bot/scraper.py` - Modified: Add API-based fetching with fallback
4. `src/mercari_bot/models.py` - Modified: Add API response models if needed
5. `requirements.txt` - Add any new dependencies

## Implementation Steps

### Phase 1: DPoP Token Extraction
1. **Create DPoP Extractor Module** (`dpop_extractor.py`)
   - Set up Selenium with network interception capabilities
   - Navigate to Mercari and trigger a search to capture DPoP headers
   - Extract and validate DPoP token from network logs
   - Implement token caching with expiration logic

2. **Network Request Interception**
   - Use Chrome DevTools Protocol to monitor network requests
   - Filter for API calls to `api.mercari.jp`
   - Extract DPoP header and other required headers (x-platform, etc.)

### Phase 2: API Client Development
3. **Create API Client Module** (`api_client.py`)
   - Implement Mercari API client class
   - Handle DPoP header injection
   - Support search endpoint with proper request formatting
   - Add error handling and retry logic

4. **Response Processing**
   - Parse API JSON responses into Item objects
   - Handle pagination if available
   - Map API fields to existing Item model

### Phase 3: Integration
5. **Modify Scraper Module**
   - Add API-first approach to `fetch_items()`
   - Implement fallback to web scraping if API fails
   - Add configuration option to prefer API vs web scraping

6. **Token Lifecycle Management**
   - Implement token refresh logic
   - Handle token expiration gracefully
   - Add monitoring for token validity

### Phase 4: Testing & Optimization
7. **Validation & Testing**
   - Test API responses match web scraping results
   - Verify all item fields are correctly mapped
   - Test error handling and fallback scenarios

8. **Performance Optimization**
   - Implement request batching if possible
   - Add rate limiting to respect API limits
   - Optimize token refresh frequency

## Technical Implementation Details

### DPoP Token Extraction Strategy
```python
# Approach 1: Network Log Interception
def extract_dpop_token(driver):
    # Enable network logging
    driver.execute_cdp_cmd('Network.enable', {})
    
    # Navigate and trigger search
    driver.get('https://jp.mercari.com/search?keyword=test')
    
    # Monitor network requests
    logs = driver.get_log('performance')
    for log in logs:
        if 'api.mercari.jp' in log['message']:
            # Extract DPoP header
            pass

# Approach 2: JavaScript Injection
def inject_fetch_interceptor(driver):
    script = """
    const originalFetch = window.fetch;
    window.dpopToken = null;
    
    window.fetch = function(...args) {
        const result = originalFetch.apply(this, args);
        // Capture DPoP from request headers
        return result;
    };
    """
    driver.execute_script(script)
```

### API Client Structure
```python
class MercariAPIClient:
    def __init__(self, dpop_token: str):
        self.dpop_token = dpop_token
        self.session = requests.Session()
    
    def search_items(self, keyword: str, sort: str = "SORT_CREATED_TIME") -> List[Item]:
        headers = {
            'x-platform': 'web',
            'dpop': self.dpop_token,
            'Content-Type': 'application/json'
        }
        
        payload = {
            "pageSize": 50,
            "searchSessionId": self._generate_session_id(),
            "searchCondition": {
                "keyword": keyword,
                "sort": sort,
                "order": "ORDER_DESC"
            }
        }
        
        response = self.session.post(
            'https://api.mercari.jp/v2/entities:search',
            headers=headers,
            json=payload
        )
        
        return self._parse_response(response.json())
```

### Integration with Existing Code
```python
def fetch_items(keyword: str, seen_items: dict, driver: webdriver.Chrome, use_api: bool = True) -> List[Item]:
    """Enhanced fetch_items with API support and fallback."""
    
    if use_api:
        try:
            # Extract fresh DPoP token
            dpop_token = extract_dpop_token(driver)
            
            # Use API client
            api_client = MercariAPIClient(dpop_token)
            return api_client.search_items(keyword)
            
        except Exception as e:
            logging.warning(f"API fetch failed, falling back to web scraping: {e}")
    
    # Fallback to existing web scraping logic
    return fetch_items_web_scraping(keyword, seen_items, driver)
```

## Configuration Options
Add to `config.yaml`:
```yaml
api:
  enabled: true
  fallback_to_scraping: true
  token_refresh_interval: 300  # seconds
  max_retries: 3
```

## Error Handling Strategy
1. **Token Extraction Failures**: Fall back to web scraping
2. **API Rate Limiting**: Implement exponential backoff
3. **Invalid Responses**: Validate and retry with fresh token
4. **Network Issues**: Retry with existing token, then refresh

## Testing Strategy
1. **Unit Tests**: Test DPoP extraction and API client separately
2. **Integration Tests**: Test full flow with real Mercari site
3. **Comparison Tests**: Verify API results match web scraping results
4. **Performance Tests**: Measure speed improvements

## Potential Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| DPoP token format changes | High | Maintain web scraping fallback |
| API rate limiting | Medium | Implement proper rate limiting and backoff |
| Network interception issues | Medium | Multiple extraction strategies |
| Token expiration | Low | Automatic refresh logic |

## Success Criteria
- [ ] Successfully extract DPoP tokens using Selenium
- [ ] API client can fetch items matching web scraping results
- [ ] Performance improvement of 2x+ over web scraping
- [ ] Fallback mechanism works seamlessly
- [ ] No regression in existing functionality

## Future Enhancements
1. **Token Reverse Engineering**: Eventually implement standalone DPoP generation
2. **Multiple Endpoints**: Support item details, user profiles, etc.
3. **Real-time Updates**: WebSocket integration if available
4. **Caching Layer**: Redis/SQLite for token and response caching 