FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /work

COPY tests/package.json tests/package-lock.json* /work/tests/
# lock 文件可选，缺失时 npm install 会自动生成
RUN cd /work/tests && (npm install --registry=https://registry.npmmirror.com || npm install)

COPY tests /work/tests

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV CI=true

WORKDIR /work/tests
CMD ["npx", "playwright", "test"]
