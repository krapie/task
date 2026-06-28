# task

## Local Setup

```bash
# build
docker build -t task .

# run
docker run -p 8080:80 task
```

## CI/CD

Push to `main` → GitHub Actions builds and pushes `krapi0314/task:<sha>` → ArgoCD deploys to k8s.

## URL

https://task.kevinprk.com.kevinprk.com
