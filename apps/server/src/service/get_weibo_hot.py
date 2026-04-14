import requests
import json
import time

def get_weibo_hot():
    """
    获取微博热搜数据
    微博热搜API可能会有变化，这里尝试几个常见的API
    """
    
    print("正在获取微博热搜数据...")
    
    # 尝试不同的微博热搜API
    apis = [
        {
            'name': '微博热搜官方API',
            'url': 'https://weibo.com/ajax/side/hotSearch',
            'headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://weibo.com/',
                'Accept': 'application/json, text/plain, */*'
            }
        },
        {
            'name': '微博热搜备用API',
            'url': 'https://weibo.com/ajax/statuses/hot_band',
            'headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://weibo.com/',
                'Accept': 'application/json, text/plain, */*'
            }
        }
    ]
    
    for api in apis:
        try:
            print(f"尝试使用 {api['name']}...")
            resp = requests.get(api['url'], headers=api['headers'], timeout=15)
            
            if resp.status_code == 200:
                data = resp.json()
                return data, api['name']
            else:
                print(f"  {api['name']} 返回状态码: {resp.status_code}")
        except Exception as e:
            print(f"  {api['name']} 请求失败: {e}")
        
        time.sleep(1)  # 请求之间稍微等待
    
    return None, None

def parse_weibo_hot_data(data, api_name):
    """
    解析微博热搜数据
    """
    print(f"\n{'='*70}")
    print(f"                    微博热搜排行榜 ({api_name})")
    print(f"{'='*70}\n")
    
    if not data:
        print("无法获取微博热搜数据")
        return
    
    # 尝试解析不同的API响应格式
    try:
        # 格式1: side/hotSearch API
        if 'data' in data and 'realtime' in data['data']:
            hot_list = data['data']['realtime']
            for i, item in enumerate(hot_list[:20], 1):
                word = item.get('word', '')
                hot = item.get('hot', '')
                category = item.get('category', '')
                
                print(f"【{i:02d}】 {word}")
                if hot:
                    print(f"     热度值: {hot}")
                if category:
                    print(f"     分类: {category}")
                print()
                
        # 格式2: hot_band API
        elif 'data' in data and 'band_list' in data['data']:
            hot_list = data['data']['band_list']
            for i, item in enumerate(hot_list[:20], 1):
                note = item.get('note', '')
                raw_hot = item.get('raw_hot', 0)
                label_name = item.get('label_name', '')
                word_scheme = item.get('word_scheme', '')
                
                print(f"【{i:02d}】🔥 {note}")
                if raw_hot:
                    print(f"     热度值: {raw_hot}")
                if label_name:
                    print(f"     标签: {label_name}")
                print()
        
        # 格式3: 其他可能的格式
        elif 'data' in data:
            print("发现未知的API格式，显示原始数据:")
            print(json.dumps(data, ensure_ascii=False, indent=2)[:500] + "...")
        
        else:
            print("无法解析API响应格式，显示原始数据:")
            print(json.dumps(data, ensure_ascii=False, indent=2)[:500] + "...")
            
    except Exception as e:
        print(f"解析数据时出错: {e}")
        print("原始数据:")
        print(json.dumps(data, ensure_ascii=False, indent=2)[:1000] + "...")

if __name__ == "__main__":
    data, api_name = get_weibo_hot()
    parse_weibo_hot_data(data, api_name)