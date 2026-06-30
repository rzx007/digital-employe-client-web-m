# 在 216 GitLab 上初始化 packaging-assets 独立仓库时使用本目录内容。

## 仓库结构

```
packaging-assets/
├── README.md
└── projects/
    └── guowang/
        ├── meta.json
        ├── brand.json
        ├── logo.png
        └── icon.ico
```

## meta.json 示例

```json
{
  "displayName": "国网数字员工",
  "description": "国家电网品牌样板",
  "createdBy": "boban"
}
```

## brand.json

字段说明见主仓库 `apps/web/branding/README.md`。

## 216 上创建仓库

1. GitLab → New project → `packaging-assets`（Internal）
2. 推送本模板 + 从主仓库复制 `apps/web/branding/guowang/` 资源
3. 在 **digital-employee-client** 项目 Settings → CI/CD → Variables 添加：
   - `BRAND_ASSETS_REPO` = `http://gitlab-ci-token:${CI_JOB_TOKEN}@10.172.246.216/<group>/packaging-assets.git`
     （实际用 Deploy Token 或 `CI_JOB_TOKEN` 在 job 内拼接，见 `docs/packaging-portal/README.md`）
4. Settings → CI/CD → Pipeline triggers → 创建 Trigger token → 配置到打包门户

## 门户上传

用户通过 `apps/packaging-portal` 提交文件到 `projects/<slug>/`，每次 commit 可复现。
