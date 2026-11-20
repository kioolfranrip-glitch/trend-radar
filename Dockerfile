# Trends World MCP server
#
# Glama (and most MCP directories) run the server in a container and check that
# it starts and answers introspection before listing it. This image only needs
# Node — the server has no dependencies beyond the standard library.
#
#   docker build -t trends-world-mcp .
#   docker run -i --rm trends-world-mcp
#
# The server speaks JSON-RPC over stdio, so run it with -i (keep stdin open).

FROM node:22-alpine

WORKDIR /app

# 只有一个文件，没有 package.json、没有 node_modules
COPY mcp/trends-mcp.mjs ./trends-mcp.mjs

ENV NODE_ENV=production \
    TRENDS_BASE=https://trends-world.pages.dev

# 不跑 root
USER node

ENTRYPOINT ["node", "trends-mcp.mjs"]
