

const shared_secret = process.env["SHARED_SECRET"];

const user_id = process.argv[2];

const hash = Bun.hash(`${user_id}:${shared_secret}`, 0);

console.log(hash.toString());