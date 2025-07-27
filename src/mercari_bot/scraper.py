from __future__ import annotations

import datetime
import logging
import time
import urllib.parse
from typing import List

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

from .models import Item
from .utils import convert_price_to_yen


def initialize_webdriver() -> webdriver.Chrome | None:
    """Return headless Chrome WebDriver or *None* on repeated failure."""

    options = Options()
    options.add_argument("--headless")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-extensions")
    options.add_argument("--window-size=1920,8192")
    options.add_argument("--blink-settings=imagesEnabled=false")

    for attempt in range(3):
        try:
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
            logging.info("WebDriver initialized successfully.")
            return driver
        except Exception as exc:
            logging.error("WebDriver initialization failed (attempt %d/3): %s", attempt + 1, exc)
            time.sleep(5)

    logging.critical("❌ WebDriver could not initialize after multiple attempts.")
    return None


def fetch_items(keyword: str, seen_items: dict, rate: float, driver: webdriver.Chrome) -> List[Item]:
    """Return new/cheaper *Item* instances for *keyword*."""

    if not driver:
        logging.error("WebDriver is not available. Cannot fetch items.")
        return []

    encoded_keyword = urllib.parse.quote(keyword)
    url = (
        "https://jp.mercari.com/zh-TW/search?keyword="
        f"{encoded_keyword}&lang=zh-TW&sort=created_time&order=desc&status=on_sale"
    )

    logging.info("Navigating to: %s", url)
    driver.get(url)

    try:
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'li[data-testid="item-cell"]'))
        )
        logging.info("Page loaded and items found.")
    except Exception as exc:
        logging.error("Timeout waiting for items for keyword '%s': %s", keyword, exc)
        return []

    # Scroll to load more items (reduced depth)
    for _ in range(2):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1)

    elements = driver.find_elements(By.CSS_SELECTOR, 'li[data-testid="item-cell"]')
    logging.info("Found %d potential items for keyword: %s", len(elements), keyword)

    elements.reverse()  # older items first to maintain chronological order

    new_items: list[Item] = []
    for el in elements:
        try:
            href = el.find_element(By.XPATH, ".//a").get_attribute("href")
            text = el.text.strip()
            title = text.split("\n")[0] if text else "Untitled Item"
            img_url = el.find_element(By.CSS_SELECTOR, "img").get_attribute("src")
            price_display, numeric_price = convert_price_to_yen(text, rate)

            if not price_display or not numeric_price:
                logging.debug("Skipping item due to price conversion issue: %s", title)
                continue

            item = Item.create(
                title=title,
                url=href,
                img_url=img_url,
                price_display=price_display,
                numeric_price=numeric_price,
            )

            if item.signature not in seen_items or numeric_price < seen_items[item.signature]["price"]:
                new_items.append(item)
                seen_items[item.signature] = {
                    "price": numeric_price,
                    "timestamp": item.timestamp,
                }
                logging.info("New or cheaper item found: %s at %s", title, price_display)
            else:
                logging.debug("Item already seen or not cheaper: %s", title)
        except Exception as exc:  # nosec B110 – broad except acceptable here for robustness
            logging.warning("Error parsing item element: %s - element text: %.100s", exc, el.text)

    return new_items 