FROM docker.m.daocloud.io/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:/root/.local/bin:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=0

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg lsb-release \
    build-essential python3 python3-pip python3-venv python3.12-dev \
    libgtk-3-0 libnss3 libx11-xcb1 \
    libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxi6 libxtst6 libxrandr2 libatk-bridge2.0-0 \
    libdrm2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
    libnotify4 libxfixes3 libxrender1 libxtst6 \
    libsecret-1-0 libsqlite3-0 \
    dpkg-dev fakeroot rsync \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.33.0

RUN curl -fsSL https://astral.sh/uv/install.sh | sh

WORKDIR /app

CMD ["/bin/bash"]
