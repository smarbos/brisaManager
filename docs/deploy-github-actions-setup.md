# Setting up the GitHub Actions deploy workflow

One-time setup for `.github/workflows/deploy.yml`. After this, every push to `main` runs the
test suite automatically, then waits for a manual approval click before deploying.

## 1. Add the deploy key to the server

A dedicated SSH keypair was generated for this (not reused from anywhere else). Add its
**public** key to the `authorized_keys` of whichever user on the production server runs
`docker compose` there:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPe4ts/gyS1Kwp/luICq85SvBSkf/6+fQyUB2eut4jZ5 brisamanager-deploy
```

On the server, as that user:

```
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPe4ts/gyS1Kwp/luICq85SvBSkf/6+fQyUB2eut4jZ5 brisamanager-deploy" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## 2. Create the `production` GitHub Environment

In the repo on GitHub: **Settings → Environments → New environment**, name it `production`.
Under **Deployment protection rules**, add yourself (or whoever should approve deploys) as a
**Required reviewer**. This is what makes the `deploy` job in the workflow pause for approval
even though it's triggered automatically on every push to `main`.

## 3. Add the environment secrets

Still on that `production` environment's page, add these four secrets:

| Secret           | Value                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| `SSH_HOST`        | The server's hostname or IP                                          |
| `SSH_USER`        | The user from step 1                                                 |
| `SSH_PRIVATE_KEY` | The **private** key's contents — see below for where to find it      |
| `DEPLOY_PATH`      | Absolute path to this repo's checkout on the server, e.g. `/opt/brisaManager` |

The private key was written locally to:

```
/tmp/claude-1000/-home-smarbos-dev-plampstify/686dab75-a555-43f1-99d4-1f853f042e68/scratchpad/deploy-key/brisamanager_deploy_ed25519
```

Open that file yourself (`cat` it, or open it in an editor) and paste its full contents —
including the `-----BEGIN ... -----`/`-----END ... -----` lines — into the `SSH_PRIVATE_KEY`
secret. **Delete that file once it's saved in GitHub** (`rm -r` the `deploy-key` directory); it
only needs to exist on disk long enough for you to copy it out. It was never printed into this
conversation.

## 4. Verify

Push any small change to `main`. The `test` job should start immediately; once it passes, the
`deploy` job will show as **Waiting** in the Actions tab until you approve it there.
