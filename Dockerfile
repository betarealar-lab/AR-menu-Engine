# Python for the app, Node for glTF-Transform. The optimise stage shells out to it, and a
# plain Python runtime has no Node - which is why export reported "no optimiser on this
# host" and kept the master instead of shipping a 99 MB file to a diner.
#
# Note what is NOT needed: libvips. Texture resizing happens in Pillow (see glb.py),
# because glTF-Transform's own texture path dies on Meshy's JPEGs with
# "colourspace: parameter space not set". Routing around it removed a whole native
# dependency, so this image stays small and boring.

FROM node:20-slim AS node

FROM python:3.12-slim

# Node runtime, lifted from the official image rather than Debian's older packages.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version

WORKDIR /app

# Dependencies first, so a code change does not reinstall the world.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN npm install -g @gltf-transform/cli@^4 \
 && npm cache clean --force \
 && gltf-transform --version

COPY . .

# Render (and most hosts) supply PORT; studio.py already reads it.
ENV PORT=10000 \
    HOST=0.0.0.0 \
    PYTHONUNBUFFERED=1
EXPOSE 10000

# Unprivileged: the app only needs to read its own source and talk to R2 and Meshy.
RUN useradd --create-home --uid 10001 studio && chown -R studio:studio /app
USER studio

# Answers before the auth check, so a probe without credentials still gets a real answer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",10000)}/healthz',timeout=4)"

CMD ["python", "studio.py", "--host", "0.0.0.0"]
