# Non-root NGINX listening on 8080 (compatible with the AKS pod security baseline).
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 8080
