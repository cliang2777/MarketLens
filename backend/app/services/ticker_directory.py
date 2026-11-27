"""Curated US equity & ETF directory with fuzzy bilingual search + Tiingo live fallback."""

import difflib
import json
import re
import ssl
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import certifi

from backend.app.config import get_tiingo_token

# (ticker, en_name, zh_name, exchange, category, aliases)
US_TICKER_CATALOG: list[tuple[str, str, str, str, str, str]] = [
    # Mega-Cap Tech & AI
    ("AAPL", "Apple Inc.", "苹果公司", "NASDAQ", "Technology", "apple appl iphone mac"),
    ("MSFT", "Microsoft Corporation", "微软", "NASDAQ", "Technology", "microsoft msf windows azure"),
    ("NVDA", "NVIDIA Corporation", "英伟达", "NASDAQ", "Semiconductors", "nvidia nvdia gpu ai"),
    ("GOOGL", "Alphabet Inc. (Class A)", "谷歌母公司 Alphabet", "NASDAQ", "Technology", "google alphabet youtube"),
    ("GOOG", "Alphabet Inc. (Class C)", "谷歌母公司 Alphabet C", "NASDAQ", "Technology", "google alphabet"),
    ("AMZN", "Amazon.com, Inc.", "亚马逊", "NASDAQ", "Consumer Discretionary", "amazon aws prime"),
    ("META", "Meta Platforms, Inc.", "Meta (原Facebook)", "NASDAQ", "Communication", "meta facebook instagram whatsapp"),
    ("TSLA", "Tesla, Inc.", "特斯拉", "NASDAQ", "Automotive / EV", "tesla tela ev"),
    ("AVGO", "Broadcom Inc.", "博通", "NASDAQ", "Semiconductors", "broadcom"),
    ("AMD", "Advanced Micro Devices, Inc.", "超威半导体 AMD", "NASDAQ", "Semiconductors", "amd ryzen"),
    ("INTC", "Intel Corporation", "英特尔", "NASDAQ", "Semiconductors", "intel"),
    ("QCOM", "QUALCOMM Incorporated", "高通", "NASDAQ", "Semiconductors", "qualcomm"),
    ("TXN", "Texas Instruments Incorporated", "德州仪器", "NASDAQ", "Semiconductors", "texas instruments"),
    ("MU", "Micron Technology, Inc.", "美光科技", "NASDAQ", "Semiconductors", "micron memory"),
    ("ARM", "Arm Holdings plc", "ARM 控股", "NASDAQ", "Semiconductors", "arm holdings"),
    ("TSM", "Taiwan Semiconductor (TSMC ADR)", "台积电", "NYSE", "Semiconductors", "tsmc taiwan semiconductor"),
    ("ASML", "ASML Holding N.V.", "阿斯麦 ASML", "NASDAQ", "Semiconductors", "asml lithography"),
    ("ORCL", "Oracle Corporation", "甲骨文", "NYSE", "Software", "oracle"),
    ("CRM", "Salesforce, Inc.", "赛富时 Salesforce", "NYSE", "Software", "salesforce"),
    ("ADBE", "Adobe Inc.", "Adobe 奥多比", "NASDAQ", "Software", "adobe photoshop"),
    ("CSCO", "Cisco Systems, Inc.", "思科", "NASDAQ", "Networking", "cisco"),
    ("IBM", "International Business Machines", "IBM 国际商业机器", "NYSE", "Technology", "ibm"),
    ("NOW", "ServiceNow, Inc.", "ServiceNow", "NYSE", "Software", "servicenow"),
    ("INTU", "Intuit Inc.", "Intuit", "NASDAQ", "Software", "intuit turbotax"),
    ("PLTR", "Palantir Technologies Inc.", "Palantir 帕兰提尔", "NASDAQ", "AI & Software", "palantir"),
    ("SNOW", "Snowflake Inc.", "Snowflake 雪花", "NYSE", "Cloud Software", "snowflake"),
    ("PANW", "Palo Alto Networks, Inc.", "派拓网络 Palo Alto", "NASDAQ", "Cybersecurity", "palo alto"),
    ("CRWD", "CrowdStrike Holdings, Inc.", "CrowdStrike", "NASDAQ", "Cybersecurity", "crowdstrike"),
    ("NFLX", "Netflix, Inc.", "奈飞 Netflix", "NASDAQ", "Entertainment", "netflix"),
    ("UBER", "Uber Technologies, Inc.", "优步 Uber", "NYSE", "Mobility", "uber"),
    ("ABNB", "Airbnb, Inc.", "爱彼迎 Airbnb", "NASDAQ", "Travel", "airbnb"),
    ("SHOP", "Shopify Inc.", "Shopify", "NYSE", "E-Commerce", "shopify"),
    ("SPOT", "Spotify Technology S.A.", "Spotify 声田", "NYSE", "Streaming", "spotify"),
    ("DUOL", "Duolingo, Inc.", "多邻国 Duolingo", "NASDAQ", "EdTech", "duolingo"),
    ("RBLX", "Roblox Corporation", "Roblox 罗布乐思", "NYSE", "Gaming", "roblox"),
    ("APP", "AppLovin Corporation", "AppLovin", "NASDAQ", "AdTech", "applovin"),
    ("DELL", "Dell Technologies Inc.", "戴尔科技", "NYSE", "Hardware", "dell"),
    ("SONY", "Sony Group Corporation (ADR)", "索尼", "NYSE", "Consumer Tech", "sony playstation"),

    # Consumer Brands, Food & Retail (including Coca-Cola, McDonald's, etc.)
    ("KO", "The Coca-Cola Company", "可口可乐", "NYSE", "Consumer Staples", "coca cola cocacola coco cola coke"),
    ("PEP", "PepsiCo, Inc.", "百事可乐", "NASDAQ", "Consumer Staples", "pepsi pepsico"),
    ("MCD", "McDonald's Corporation", "麦当劳", "NYSE", "Consumer Discretionary", "mcdonald mcdonalds"),
    ("SBUX", "Starbucks Corporation", "星巴克", "NASDAQ", "Consumer Discretionary", "starbucks coffee"),
    ("NKE", "NIKE, Inc.", "耐克 Nike", "NYSE", "Apparel", "nike"),
    ("LULU", "Lululemon Athletica Inc.", "露露乐蒙 Lululemon", "NASDAQ", "Apparel", "lululemon"),
    ("DIS", "The Walt Disney Company", "迪士尼", "NYSE", "Entertainment", "disney"),
    ("COST", "Costco Wholesale Corporation", "开市客 Costco", "NASDAQ", "Retail", "costco"),
    ("WMT", "Walmart Inc.", "沃尔玛", "NYSE", "Retail", "walmart"),
    ("TGT", "Target Corporation", "塔吉特 Target", "NYSE", "Retail", "target"),
    ("HD", "The Home Depot, Inc.", "家得宝 Home Depot", "NYSE", "Retail", "home depot"),
    ("LOW", "Lowe's Companies, Inc.", "劳氏 Lowe's", "NYSE", "Retail", "lowes"),
    ("PG", "The Procter & Gamble Company", "宝洁 P&G", "NYSE", "Consumer Staples", "procter gamble p&g"),
    ("CL", "Colgate-Palmolive Company", "高露洁", "NYSE", "Consumer Staples", "colgate"),
    ("MDLZ", "Mondelez International, Inc.", "亿滋国际", "NASDAQ", "Consumer Staples", "mondelez oreo"),
    ("CMG", "Chipotle Mexican Grill, Inc.", "Chipotle 墨西哥烤肉", "NYSE", "Restaurants", "chipotle"),
    ("YUM", "Yum! Brands, Inc.", "百胜餐饮 (KFC/必胜客)", "NYSE", "Restaurants", "yum kfc pizza hut"),
    ("DPZ", "Domino's Pizza, Inc.", "达美乐披萨", "NASDAQ", "Restaurants", "dominos"),
    ("PM", "Philip Morris International", "菲利普莫里斯", "NYSE", "Consumer Staples", "philip morris"),
    ("F", "Ford Motor Company", "福特汽车", "NYSE", "Automotive", "ford"),
    ("GM", "General Motors Company", "通用汽车", "NYSE", "Automotive", "general motors"),
    ("TM", "Toyota Motor Corporation (ADR)", "丰田汽车", "NYSE", "Automotive", "toyota"),
    ("RIVN", "Rivian Automotive, Inc.", "Rivian 电动皮卡", "NASDAQ", "Automotive / EV", "rivian"),
    ("CROX", "Crocs, Inc.", "卡骆驰 Crocs", "NASDAQ", "Footwear", "crocs"),

    # Financials & Payments
    ("BRK-B", "Berkshire Hathaway Inc. (Class B)", "伯克希尔·哈撒韦 B", "NYSE", "Financials", "berkshire hathaway buffett"),
    ("JPM", "JPMorgan Chase & Co.", "摩根大通", "NYSE", "Banking", "jpmorgan jp morgan chase"),
    ("BAC", "Bank of America Corporation", "美国银行", "NYSE", "Banking", "bank of america bofa"),
    ("WFC", "Wells Fargo & Company", "富国银行", "NYSE", "Banking", "wells fargo"),
    ("GS", "The Goldman Sachs Group, Inc.", "高盛集团", "NYSE", "Investment Banking", "goldman sachs"),
    ("MS", "Morgan Stanley", "摩根士丹利", "NYSE", "Investment Banking", "morgan stanley"),
    ("C", "Citigroup Inc.", "花旗集团", "NYSE", "Banking", "citigroup citi"),
    ("BLK", "BlackRock, Inc.", "贝莱德 BlackRock", "NYSE", "Asset Management", "blackrock"),
    ("SCHW", "The Charles Schwab Corporation", "嘉信理财", "NYSE", "Brokerage", "charles schwab"),
    ("V", "Visa Inc.", "维萨 Visa", "NYSE", "Payments", "visa"),
    ("MA", "Mastercard Incorporated", "万事达 Mastercard", "NYSE", "Payments", "mastercard"),
    ("AXP", "American Express Company", "美国运通 AmEx", "NYSE", "Payments", "american express amex"),
    ("PYPL", "PayPal Holdings, Inc.", "PayPal 贝宝", "NASDAQ", "FinTech", "paypal"),
    ("COIN", "Coinbase Global, Inc.", "Coinbase", "NASDAQ", "Crypto / FinTech", "coinbase"),
    ("SPGI", "S&P Global Inc.", "标普全球 S&P Global", "NYSE", "Financial Data", "sp global"),
    ("MCO", "Moody's Corporation", "穆迪 Moody's", "NYSE", "Financial Data", "moodys"),

    # Healthcare & Pharma
    ("LLY", "Eli Lilly and Company", "礼来制药", "NYSE", "Healthcare", "eli lilly"),
    ("NVO", "Novo Nordisk A/S (ADR)", "诺和诺德", "NYSE", "Healthcare", "novo nordisk ozempic"),
    ("UNH", "UnitedHealth Group Incorporated", "联合健康集团", "NYSE", "Healthcare", "unitedhealth"),
    ("JNJ", "Johnson & Johnson", "强生公司", "NYSE", "Healthcare", "johnson and johnson j&j"),
    ("ABBV", "AbbVie Inc.", "艾伯维 AbbVie", "NYSE", "Pharma", "abbvie"),
    ("MRK", "Merck & Co., Inc.", "默沙东 Merck", "NYSE", "Pharma", "merck"),
    ("PFE", "Pfizer Inc.", "辉瑞制药", "NYSE", "Pharma", "pfizer"),
    ("TMO", "Thermo Fisher Scientific Inc.", "赛默飞世尔", "NYSE", "Life Sciences", "thermo fisher"),
    ("ABT", "Abbott Laboratories", "雅培 Abbott", "NYSE", "MedTech", "abbott"),
    ("ISRG", "Intuitive Surgical, Inc.", "直觉外科 (达芬奇手术)", "NASDAQ", "MedTech", "intuitive surgical"),

    # Energy, Industrials, Aerospace & Telecom
    ("XOM", "Exxon Mobil Corporation", "埃克森美孚", "NYSE", "Energy", "exxon mobil"),
    ("CVX", "Chevron Corporation", "雪佛龙", "NYSE", "Energy", "chevron"),
    ("COP", "ConocoPhillips", "康菲石油", "NYSE", "Energy", "conocophillips"),
    ("BA", "The Boeing Company", "波音公司", "NYSE", "Aerospace", "boeing"),
    ("CAT", "Caterpillar Inc.", "卡特彼勒", "NYSE", "Industrials", "caterpillar"),
    ("DE", "Deere & Company", "迪尔公司 John Deere", "NYSE", "Industrials", "john deere"),
    ("GE", "GE Aerospace", "通用电气航空 GE", "NYSE", "Aerospace", "general electric ge aerospace"),
    ("HON", "Honeywell International Inc.", "霍尼韦尔", "NASDAQ", "Industrials", "honeywell"),
    ("LMT", "Lockheed Martin Corporation", "洛克希德·马丁", "NYSE", "Defense", "lockheed martin"),
    ("RTX", "RTX Corporation", "雷神技术 RTX", "NYSE", "Aerospace & Defense", "raytheon rtx"),
    ("UPS", "United Parcel Service, Inc.", "联合包裹 UPS", "NYSE", "Logistics", "ups"),
    ("FDX", "FedEx Corporation", "联邦快递 FedEx", "NYSE", "Logistics", "fedex"),
    ("UNP", "Union Pacific Corporation", "联合太平洋铁路", "NYSE", "Railroads", "union pacific"),
    ("T", "AT&T Inc.", "AT&T 美国电话电报", "NYSE", "Telecom", "att at&t"),
    ("VZ", "Verizon Communications Inc.", "威瑞森 Verizon", "NYSE", "Telecom", "verizon"),
    ("TMUS", "T-Mobile US, Inc.", "T-Mobile 美国", "NASDAQ", "Telecom", "tmobile t-mobile"),
    ("NEE", "NextEra Energy, Inc.", "新纪元能源", "NYSE", "Utilities", "nextera"),

    # Popular US-Listed China ADRs
    ("BABA", "Alibaba Group Holding (ADR)", "阿里巴巴 (美股ADR)", "NYSE", "E-Commerce ADR", "alibaba taobao"),
    ("PDD", "PDD Holdings Inc. (ADR)", "拼多多 (美股ADR)", "NASDAQ", "E-Commerce ADR", "pinduoduo temu pdd"),
    ("JD", "JD.com, Inc. (ADR)", "京东 (美股ADR)", "NASDAQ", "E-Commerce ADR", "jd jingdong"),
    ("BIDU", "Baidu, Inc. (ADR)", "百度 (美股ADR)", "NASDAQ", "Tech ADR", "baidu"),
    ("NIO", "NIO Inc. (ADR)", "蔚来汽车 (美股ADR)", "NYSE", "EV ADR", "nio"),
    ("LI", "Li Auto Inc. (ADR)", "理想汽车 (美股ADR)", "NASDAQ", "EV ADR", "li auto"),
    ("XPEV", "XPeng Inc. (ADR)", "小鹏汽车 (美股ADR)", "NYSE", "EV ADR", "xpeng"),

    # Major US Equity, Bond, Sector & Commodity ETFs
    ("SPY", "SPDR S&P 500 ETF Trust", "标普500指数 ETF", "NYSE ARCA", "US Equity ETF", "sp500 s&p 500 spx market benchmark"),
    ("VOO", "Vanguard S&P 500 ETF", "先锋标普500 ETF", "NYSE ARCA", "US Equity ETF", "vanguard sp500 s&p 500"),
    ("IVV", "iShares Core S&P 500 ETF", "安硕核心标普500 ETF", "NYSE ARCA", "US Equity ETF", "ishares sp500 s&p 500"),
    ("VTI", "Vanguard Total Stock Market ETF", "先锋美股全市场 ETF", "NYSE ARCA", "US Equity ETF", "vanguard total market"),
    ("QQQ", "Invesco QQQ Trust (Nasdaq 100)", "纳斯达克100 ETF", "NASDAQ", "US Tech ETF", "nasdaq 100 ndx invesco"),
    ("QQQM", "Invesco NASDAQ 100 ETF (Mini)", "纳斯达克100 低费率 ETF", "NASDAQ", "US Tech ETF", "nasdaq 100 mini"),
    ("DIA", "SPDR Dow Jones Industrial ETF", "道琼斯工业指数 ETF", "NYSE ARCA", "US Equity ETF", "dow jones dji"),
    ("IWM", "iShares Russell 2000 ETF", "罗素2000小盘股 ETF", "NYSE ARCA", "Small Cap ETF", "russell 2000 small cap"),
    ("VT", "Vanguard Total World Stock ETF", "先锋全球股市 ETF", "NYSE ARCA", "Global ETF", "global world stock"),
    ("EEM", "iShares MSCI Emerging Markets ETF", "新兴市场 ETF", "NYSE ARCA", "Intl ETF", "emerging markets"),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "20年以上长期美债 ETF", "NASDAQ", "US Treasury ETF", "treasury bond long duration"),
    ("IEF", "iShares 7-10 Year Treasury Bond ETF", "7-10年中期美债 ETF", "NASDAQ", "US Treasury ETF", "treasury bond medium"),
    ("SHY", "iShares 1-3 Year Treasury Bond ETF", "1-3年短期美债 ETF", "NASDAQ", "US Treasury ETF", "short treasury cash"),
    ("BND", "Vanguard Total Bond Market ETF", "先锋美国综合债券 ETF", "NASDAQ", "Bond ETF", "total bond"),
    ("AGG", "iShares Core U.S. Aggregate Bond ETF", "安硕美国综合债券 ETF", "NYSE ARCA", "Bond ETF", "aggregate bond"),
    ("HYG", "iShares iBoxx High Yield Bond ETF", "美国高收益债 ETF", "NYSE ARCA", "Credit ETF", "high yield junk bond"),
    ("GLD", "SPDR Gold Shares", "实物黄金 ETF", "NYSE ARCA", "Commodity ETF", "gold bullion"),
    ("IAU", "iShares Gold Trust", "安硕黄金信托 ETF", "NYSE ARCA", "Commodity ETF", "gold"),
    ("SLV", "iShares Silver Trust", "白银实物 ETF", "NYSE ARCA", "Commodity ETF", "silver"),
    ("USO", "United States Oil Fund, LP", "美国原油基金 ETF", "NYSE ARCA", "Commodity ETF", "oil crude wti"),
    ("VNQ", "Vanguard Real Estate ETF", "先锋美国房地产 REITs ETF", "NYSE ARCA", "Real Estate ETF", "reit real estate"),
    ("XLF", "Financial Select Sector SPDR Fund", "标普金融板块 ETF", "NYSE ARCA", "Sector ETF", "financials sector"),
    ("XLK", "Technology Select Sector SPDR Fund", "标普科技板块 ETF", "NYSE ARCA", "Sector ETF", "technology sector"),
    ("XLE", "Energy Select Sector SPDR Fund", "标普能源板块 ETF", "NYSE ARCA", "Sector ETF", "energy sector"),
    ("XLV", "Health Care Select Sector SPDR Fund", "标普医疗板块 ETF", "NYSE ARCA", "Sector ETF", "healthcare sector"),
    ("XLP", "Consumer Staples Select Sector SPDR", "标普必需消费板块 ETF", "NYSE ARCA", "Sector ETF", "consumer staples"),
    ("XLY", "Consumer Discretionary Select SPDR", "标普可选消费板块 ETF", "NYSE ARCA", "Sector ETF", "consumer discretionary"),
    ("SOXX", "iShares Semiconductor ETF", "安硕半导体 ETF", "NASDAQ", "Sector ETF", "semiconductor chips"),
    ("SMH", "VanEck Semiconductor ETF", "VanEck 半导体 ETF", "NASDAQ", "Sector ETF", "semiconductor chips"),
    ("ARKK", "ARK Innovation ETF", "木头姐创新科技 ETF", "NYSE ARCA", "Thematic ETF", "ark cathie wood innovation"),
]

CATALOG_BY_TICKER: dict[str, dict] = {
    row[0]: {
        "ticker": row[0],
        "name": row[1],
        "nameZh": row[2],
        "exchange": row[3],
        "category": row[4],
        "aliases": row[5],
    }
    for row in US_TICKER_CATALOG
}

DEFAULT_FEATURED = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "KO", "SPY", "QQQ", "TLT", "GLD"]

_LIVE_SEARCH_CACHE: dict[str, tuple[float, list[dict]]] = {}
_LIVE_CACHE_TTL_SECONDS = 3600.0
_NOISY_TICKER_RE = re.compile(r"(-P-|PR[A-Z]$|[A-Z]{4}[FY]$|W$|WS$)")


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", text.lower())


def get_chinese_name(ticker: str) -> str | None:
    entry = CATALOG_BY_TICKER.get(ticker.upper().strip())
    return entry["nameZh"] if entry else None


def _score_local_entry(q_raw: str, q_norm: str, q_tokens: list[str], item: dict) -> float:
    ticker = item["ticker"]
    ticker_l = ticker.lower()
    name_norm = _norm(item["name"])
    alias_norm = _norm(item["aliases"])
    zh_norm = _norm(item["nameZh"])
    combined_words = re.findall(r"[a-z0-9]+", f"{item['name']} {item['aliases']}".lower())

    if q_norm == ticker_l:
        return 1000.0
    alias_words = set(item["aliases"].lower().split())
    if q_norm in alias_words:
        return 910.0
    if ticker_l.startswith(q_norm) and len(q_norm) >= 1:
        return 860.0 - (len(ticker_l) - len(q_norm)) * 8.0
    if q_raw in item["nameZh"] or (zh_norm and q_norm in zh_norm):
        return 840.0
    if q_norm in name_norm or q_norm in alias_norm:
        return 760.0

    # Multi-word fuzzy match (e.g. "coco cola" -> "coca cola", "mcdonald" -> "mcdonalds")
    if q_tokens:
        token_scores = []
        for qt in q_tokens:
            if len(qt) < 2:
                continue
            best_tok = 0.0
            for w in combined_words:
                if w.startswith(qt):
                    best_tok = max(best_tok, 0.96)
                elif qt in w:
                    best_tok = max(best_tok, 0.85)
                else:
                    ratio = difflib.SequenceMatcher(None, qt, w).ratio()
                    if ratio > best_tok:
                        best_tok = ratio
            token_scores.append(best_tok)

        if token_scores:
            avg_score = sum(token_scores) / len(token_scores)
            min_score = min(token_scores)
            if avg_score >= 0.74 and min_score >= 0.65:
                return 600.0 + avg_score * 140.0

    # Direct whole-string fuzzy match against ticker or compact name (e.g. "appl" -> "AAPL", "cococola" -> "cocacola")
    t_sim = difflib.SequenceMatcher(None, q_norm, ticker_l).ratio()
    if len(q_norm) >= 3 and t_sim >= 0.74:
        return 580.0 + t_sim * 120.0

    alias_phrases = [item["name"], *item["aliases"].split()]
    best_phrase = max(
        difflib.SequenceMatcher(None, q_norm, _norm(p)).ratio()
        for p in alias_phrases
        if p
    )
    if len(q_norm) >= 4 and best_phrase >= 0.72:
        return 540.0 + best_phrase * 120.0

    return 0.0


def _search_tiingo_live(query: str, limit: int = 12) -> list[dict]:
    token = get_tiingo_token()
    if not token or len(query.strip()) < 2:
        return []

    cache_key = query.strip().lower()
    cached = _LIVE_SEARCH_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _LIVE_CACHE_TTL_SECONDS:
        return cached[1]

    url = "https://api.tiingo.com/tiingo/utilities/search?" + urlencode(
        {"query": query.strip(), "limit": limit}
    )
    req = Request(
        url,
        headers={
            "Authorization": f"Token {token}",
            "User-Agent": "AlphaMetric Quantitative Terminal",
        },
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    try:
        with urlopen(req, timeout=8, context=ssl_context) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []

    if not isinstance(raw, list):
        return []

    seen: set[str] = set()
    cleaned: list[dict] = []
    for item in raw:
        tkr = str(item.get("ticker") or "").strip().upper()
        name = str(item.get("name") or "").strip()
        asset_type = str(item.get("assetType") or "").strip()
        if not tkr or not name or tkr in seen:
            continue
        if asset_type == "Mutual Fund":
            continue
        if len(tkr) > 6 or not re.match(r"^[A-Z0-9.\-]+$", tkr):
            continue
        # Skip noisy preferred stocks / OTC foreign pink-sheet wrappers unless user typed ticker directly
        if _NOISY_TICKER_RE.search(tkr) and not tkr.startswith(query.strip().upper()):
            continue
        seen.add(tkr)
        cleaned.append(
            {
                "ticker": tkr,
                "name": name,
                "nameZh": CATALOG_BY_TICKER.get(tkr, {}).get("nameZh", ""),
                "exchange": "US",
                "category": asset_type or "US Equity",
                "source": "tiingo",
            }
        )

    _LIVE_SEARCH_CACHE[cache_key] = (time.time(), cleaned)
    return cleaned


def search_us_tickers(query: str, limit: int = 8, allow_live: bool = True) -> list[dict]:
    q_raw = (query or "").strip()
    if not q_raw:
        return [
            {
                "ticker": sym,
                "name": CATALOG_BY_TICKER[sym]["name"],
                "nameZh": CATALOG_BY_TICKER[sym]["nameZh"],
                "exchange": CATALOG_BY_TICKER[sym]["exchange"],
                "category": CATALOG_BY_TICKER[sym]["category"],
                "source": "directory",
            }
            for sym in DEFAULT_FEATURED[:limit]
        ]

    q_norm = _norm(q_raw)
    q_tokens = re.findall(r"[a-z0-9]+", q_raw.lower())

    scored: list[tuple[float, dict]] = []
    for item in CATALOG_BY_TICKER.values():
        s = _score_local_entry(q_raw, q_norm, q_tokens, item)
        if s > 0:
            scored.append((s, item))

    scored.sort(key=lambda pair: (-pair[0], len(pair[1]["ticker"]), pair[1]["ticker"]))

    results: list[dict] = []
    seen: set[str] = set()
    for _, item in scored[:limit]:
        seen.add(item["ticker"])
        results.append(
            {
                "ticker": item["ticker"],
                "name": item["name"],
                "nameZh": item["nameZh"],
                "exchange": item["exchange"],
                "category": item["category"],
                "source": "directory",
            }
        )

    # Trigger live Tiingo US search fallback for niche tickers (3+ chars, or 2+ if no local match)
    has_ascii = bool(re.search(r"[a-zA-Z]", q_raw))
    should_live = (len(q_raw) >= 3 and len(results) < 5) or (len(q_raw) >= 2 and len(results) == 0)
    if allow_live and has_ascii and should_live:
        live_hits = _search_tiingo_live(q_raw, limit=14)
        for hit in live_hits:
            if hit["ticker"] not in seen:
                seen.add(hit["ticker"])
                results.append(hit)
            if len(results) >= limit:
                break

    return results[:limit]
