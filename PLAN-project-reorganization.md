# Project Reorganization Plan

## Purpose & Scope
Refactor the monolithic `mercari_telegram_bot_config_improved.py` into a well-structured Python package following best practices with proper separation of concerns, maintainability, and testability.

## Current State Analysis
- Single 354-line Python file containing all functionality
- Mixed concerns: configuration, web scraping, Telegram API, data persistence, scheduling
- Basic requirements.txt and empty pyproject.toml
- Dockerized application

## Target Structure
```
mercari_jp_bot/
├── src/
│   └── mercari_bot/
│       ├── __init__.py
│       ├── config.py          # Configuration management
│       ├── models.py          # Data models and classes
│       ├── telegram.py        # Telegram bot functionality
│       ├── scraper.py         # Web scraping logic
│       ├── store.py           # Data persistence
│       ├── utils.py           # Utility functions
│       ├── scheduler.py       # Scheduling functionality
│       └── main.py            # Main application logic
├── pyproject.toml             # Modern Python project configuration
├── requirements.txt           # Dependencies
├── Dockerfile                 # Updated for new structure
├── config.ini                 # Configuration file
├── key.env                    # Environment variables
└── README.md                  # Updated documentation
```

## Implementation Steps

### 1. Create Package Structure
- Create `src/mercari_bot/` directory
- Add `__init__.py` with version and package exports

### 2. Extract Configuration Management (`config.py`)
- Settings dataclass for type safety
- Configuration loading from INI file and environment
- Validation and error handling

### 3. Create Data Models (`models.py`)
- Item dataclass for scraped items
- Type hints and validation
- Hash generation for deduplication

### 4. Separate Telegram Functionality (`telegram.py`)
- Message sending functions
- Photo sending with captions
- Error handling and retry logic

### 5. Extract Web Scraping (`scraper.py`)
- WebDriver initialization and management
- Item fetching and parsing
- Price conversion logic

### 6. Data Persistence (`store.py`)
- JSON file operations for seen items
- Data trimming and cleanup
- Error handling for file operations

### 7. Utility Functions (`utils.py`)
- Price conversion utilities
- Memory logging
- Common helper functions

### 8. Scheduling Logic (`scheduler.py`)
- Daily summary functionality
- Schedule management

### 9. Main Application Logic (`main.py`)
- Clean entry point
- Main loop orchestration
- Error handling and graceful shutdown

### 10. Update Project Configuration
- Modern `pyproject.toml` with build system
- Updated dependencies in requirements.txt
- Update Dockerfile for new structure

### 11. Update Documentation
- README with new structure
- Import examples
- Development setup

## Benefits
- **Separation of Concerns**: Each module has a single responsibility
- **Maintainability**: Easier to modify and extend individual components
- **Testability**: Components can be unit tested in isolation
- **Reusability**: Modules can be imported and used independently
- **Type Safety**: Better IDE support and error detection
- **Modern Python**: Follows current best practices

## Potential Risks
- Import path changes require careful testing
- Docker configuration needs updating
- Config file path resolution may need adjustment
- Need to ensure all functionality is preserved

## Testing Strategy
- Verify each module can be imported correctly
- Test configuration loading
- Validate web scraping functionality
- Confirm Telegram integration works
- End-to-end testing of the complete flow

## Follow-up Tasks
- Add comprehensive logging configuration
- Consider adding tests directory structure
- Implement proper error handling hierarchy
- Add configuration validation
- Consider adding CLI interface with argparse

