FROM node:20-alpine

WORKDIR /app
COPY server.mjs .

EXPOSE 8080
# The mock API runs unprivileged: the image default would be root.
USER node
CMD ["node", "server.mjs"]
