FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb

WORKDIR /app
COPY server.mjs .

EXPOSE 8080
# The mock API runs unprivileged: the image default would be root.
USER node
CMD ["node", "server.mjs"]
