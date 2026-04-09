import requests
import json

url = 'https://top.baidu.com/api/board?platform=pc&tab=realtime'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://top.baidu.com/',
}

try:
    resp = requests.get(url, headers=headers, timeout=15)
    print('Status:', resp.status_code)
    print('Content-Type:', resp.headers.get('content-type', 'N/A'))
    print()
    if resp.status_code == 200:
        data = resp.json()
        print(json.dumps(data, indent=2, ensure_ascii=False)[:4000])
except Exception as e:
    print(f'Error: {e}')
