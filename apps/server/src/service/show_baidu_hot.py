import requests
import json

url = 'https://top.baidu.com/api/board?platform=pc&tab=realtime'
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

resp = requests.get(url, headers=headers, timeout=15)
data = resp.json()

# 提取热点列表
hot_list = data['data']['cards'][0]['content']

print('=' * 70)
print('                      📊 百度热搜排行榜')
print('=' * 70)
print()

for item in hot_list:
    rank = item['index'] + 1
    word = item['word']
    score = item['hotScore']
    desc = item['desc']
    if len(desc) > 60:
        desc = desc[:60] + '...'
    
    print(f'【{rank:02d}】🔥 {word}')
    print(f'       热度值: {score}')
    if desc:
        print(f'       摘要: {desc}')
    print()
