# 本机构建时可改用国内镜像（216 无加速，镜像在本机 build 后 load）
ARG BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim
FROM ${BASE_IMAGE}

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY packaging_portal ./packaging_portal
COPY static ./static

RUN mkdir -p /data

EXPOSE 8080

CMD ["uvicorn", "packaging_portal.main:app", "--host", "0.0.0.0", "--port", "8080"]
