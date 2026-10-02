FROM node:22-alpine
WORKDIR /app
COPY server.mjs package.json ./
ENV HOST=0.0.0.0
ENV PORT=8787
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
