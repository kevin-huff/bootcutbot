# bootcutbot
This is a node.js twitch bot that runs a queue system. Purpose built for the game of bootcut it is a good basis for other queue based bots.

# install
1. Run `npm install`
2. Copy `.env.example` to `.env`
3. Add your details to `.env`


## Asset Migration

To migrate assets from `cdn.glitch.global` to your Cloudflare R2 bucket and update references, set the following environment variables in your `.env` file or shell:

```
R2_ACCESS_KEY_ID=<your access key>
R2_SECRET_ACCESS_KEY=<your secret key>
R2_ACCOUNT_ID=<your account id>
R2_BUCKET_NAME=<bucket name>
```

Run the migration script with:

```
npm run migrate-assets
```

The script downloads each asset listed in `.glitch-assets`, uploads it to Cloudflare R2, and rewrites file references to use `https://cdn.leantube.org/<filename>`.
