# syntax=docker/dockerfile:1

# Both build stages produce architecture-independent output (the publish output carries libvips for
# every Linux architecture under runtimes/), so they run natively on the build machine. Only the
# final stage is per-architecture, which keeps multi-arch builds fast.
FROM --platform=$BUILDPLATFORM node:22-alpine AS client
WORKDIR /src

COPY client/package.json client/package-lock.json client/
RUN npm --prefix client ci

COPY client/ client/
# The changelog is built into the app: it shows what changed after an update.
COPY CHANGELOG.md ./
RUN npm --prefix client run build -- --outDir /wwwroot --emptyOutDir

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY server/Tilorama.Server/Tilorama.Server.csproj server/Tilorama.Server/
RUN dotnet restore server/Tilorama.Server/Tilorama.Server.csproj

COPY server/Tilorama.Server/ server/Tilorama.Server/
# libvips for Windows is never used in this image.
RUN dotnet publish server/Tilorama.Server/Tilorama.Server.csproj -c Release -o /app/publish --no-restore \
 && find /app/publish/runtimes -mindepth 1 -maxdepth 1 ! -name linux-x64 ! -name linux-arm64 -exec rm -rf {} +
COPY --from=client /wwwroot/ /app/publish/wwwroot/

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# The net.unraid.docker.* label gives the container its "WebUI" link on Unraid's Docker page.
LABEL org.opencontainers.image.title="Tilorama" \
      org.opencontainers.image.description="Fast deep-zoom viewer for gigapixel images" \
      org.opencontainers.image.source="https://github.com/Tunefish92/Tilorama" \
      org.opencontainers.image.licenses="MIT" \
      net.unraid.docker.webui="http://[IP]:[PORT:8080]/"

# curl: container health check
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data

COPY --from=build /app/publish .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip CR in case the script was checked out with Windows line endings.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod 755 /usr/local/bin/docker-entrypoint.sh

# Uploaded originals, tiles and settings live in /data.
ENV URLS=http://+:8080 \
    TileCache__Root=/data \
    PUID=1000 \
    PGID=1000

# Starts as root only long enough for docker-entrypoint.sh to give /data to PUID:PGID, then
# runs the app as that user.
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
