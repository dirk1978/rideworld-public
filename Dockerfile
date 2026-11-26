# RideWorld in a container: Node, plus openssl (the first certificate) and ffmpeg (ride clips to MP4)
FROM node:22-alpine
RUN apk add --no-cache openssl ffmpeg
WORKDIR /app
COPY . .
RUN chmod +x docker-entrypoint.sh && mkdir -p data certs && chown -R node:node /app
USER node
ENV PORT=8443
EXPOSE 8443
VOLUME ["/app/data", "/app/certs"]
ENTRYPOINT ["./docker-entrypoint.sh"]
