# 自定义 electron-updater 服务

对于 electron-updater，需要按照特定的格式组织更新文件。假设你的 Nginx 根目录是 /usr/share/nginx/html，建议按以下结构组织：

```bash
/usr/share/nginx/html/
└── win32/
    ├── latest.yml           # 始终指向最新版本
    ├── versions/            # 存放所有历史版本信息
    │   ├── 0.1.0.yml
    │   ├── 0.1.1.yml
    │   └── 0.1.2.yml
    └── releases/           # 存放所有版本的安装包
        ├── 0.1.0/
        │   ├── app-0.1.0.exe
        │   └── app-0.1.0.exe.blockmap
        ├── 0.1.1/
        │   ├── app-0.1.1.exe
        │   └── app-0.1.1.exe.blockmap
        └── 0.1.2/
            ├── app-0.1.2.exe
            └── app-0.1.2.exe.blockmap
```

## 首先配置 Nginx：

```nginx
# /etc/nginx/conf.d/update-server.conf
server {
    listen 80;
    server_name your-update-server.com;  # 替换为你的域名

    # 启用目录浏览（可选）
    autoindex on;

    # 设置跨域
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
    add_header Access-Control-Allow-Headers 'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization';

    location / {
        root /usr/share/nginx/html;

        # 设置正确的 MIME 类型
        types {
            application/octet-stream exe;
            text/yaml yml;
        }

        # 禁用缓存，确保始终获取最新的更新信息
        add_header Cache-Control no-cache;

        # 如果文件较大，可以启用 gzip 压缩
        gzip on;
        gzip_types application/octet-stream;
    }
}
```

## latest.yml 文件格式示例：

```yaml
version: 0.1.2
files:
  - url: app-0.1.2.exe
    sha512: xxxxxxxxxxxxx
    size: 68540879
path: app-0.1.2.exe
sha512: xxxxxxxxxxxxx
releaseDate: '2024-04-09T14:28:00.000Z'
```

## 发布更新流程：

```bash
# 1. 构建新版本

pnpm build

# 2. 创建版本目录

ssh your-server "mkdir -p /usr/share/nginx/html/win32/0.1.2"

# 3. 上传文件

scp dist/app-0.1.2.exe your-server:/usr/share/nginx/html/win32/0.1.2/
scp dist/app-0.1.2.exe.blockmap your-server:/usr/share/nginx/html/win32/0.1.2/
scp dist/latest.yml your-server:/usr/share/nginx/html/win32/

# 4. 设置权限

ssh your-server "chmod -R 755 /usr/share/nginx/html/win32"
```

## 检查更新服务是否正常：

```bash
# 测试 latest.yml 是否可访问
curl http://your-update-server.com/win32/latest.yml

# 测试安装包是否可下载
curl -I http://your-update-server.com/win32/0.1.2/app-0.1.2.exe
```

## node作为更新服务

```ts
// app/server/update-server.ts
import express from 'express'
import cors from 'cors'
import path from 'path'

const app = express()
const port = 8080

// 启用 CORS
app.use(cors())

// 静态文件目录配置
const UPDATES_DIR = path.join(__dirname, '../updates')

// 静态文件服务
app.use(
  '/win32',
  express.static(UPDATES_DIR, {
    setHeaders: (res) => {
      // 设置响应头
      res.set('Access-Control-Allow-Origin', '*')
      res.set('Cache-Control', 'no-cache')
      // 根据文件类型设置正确的 Content-Type
      res.set(
        'Content-Type',
        (res.getHeader('Content-Type') as string)?.replace('application/x-yaml', 'text/yaml') ||
          'application/octet-stream',
      )
    },
  }),
)

// 版本检查接口
app.get('/win32/latest.yml', (req, res) => {
  res.sendFile(path.join(UPDATES_DIR, 'latest.yml'))
})

// 下载更新包
app.get('/win32/:file', (req, res) => {
  const { version, file } = req.params
  res.sendFile(path.join(UPDATES_DIR, `${file}`))
})

// 错误处理
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err)
  res.status(500).send('Internal Server Error')
})

app.listen(port, () => {
  console.log(`Update server is running at http://localhost:${port}`)
})
```
