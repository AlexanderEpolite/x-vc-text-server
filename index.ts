import Elysia, { t } from "elysia";

const shared_secret = process.env["SHARED_SECRET"];

if(!shared_secret) throw new Error("no shared secret");

type UserType = {
    username: string,
    
    //avatar is the hash, not full uri
    avatar: string,
};

async function getUserFromID(user_id: string): Promise<UserType> {
    const cache_hit_avatar = await Bun.redis.get("user-avatar:" + user_id);
    const cache_hit_username = await Bun.redis.get("user-name:" + user_id);
    
    if(cache_hit_avatar && cache_hit_username) {
        return {
            username: cache_hit_username,
            avatar: cache_hit_avatar,
        };
    } else {
        const data = await fetch("https://discord.com/api/v10/users/" + user_id, {
            headers: {
                "Authorization": "Bot " + process.env["DISCORD_TOKEN"],
            },
        });
        
        const json = await data.json() as UserType;
        
        await Bun.redis.setex("user-avatar:" + user_id, 300, json.avatar);
        await Bun.redis.setex("user-name:" + user_id, 300, json.username);
        
        return json;
    }
}

//true: good, false: hit rl
async function checkRateLimit(user_id: string): Promise<boolean> {
    const key = `user-rl:${user_id}`;
    
    const rl = await Bun.redis.get(key);
    
    console.log(rl)
    
    if(!rl) {
        await Bun.redis.setex(key, 3, "1");
        
        return true;
    } else {
        return false;
    }
}

const elysia = new Elysia()
    .options("/", (ctx) => {
        ctx.set.headers = {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "Content-Type"
        };
        
        return "ok";
    })
    .post("/", async (ctx) => {
        ctx.set.headers = {
            "access-control-allow-origin": "*"
        };
        
        if(!ctx.body.url.match(/https:\/\/x.com\/[a-zA-Z0-9_-]{1,30}\/status\/[0-9]{1,100}/)) {
            return "not ok";
        }
        
        const [user_id, final_secret] = ctx.body.auth_string.split(":");
        
        const hash = Bun.hash(`${user_id}:${shared_secret}`, 0);
        
        if(hash.toString() !== final_secret) {
            return "not ok (bad auth)";
        }
        
        if(!await checkRateLimit(user_id!)) {
            return "not ok (rate limit)";
        }
        
        const user = await getUserFromID(user_id!);
        
        const avatar_url = `https://cdn.discordapp.com/avatars/${user_id}/${user.avatar}.webp`;
        
        await fetch(process.env["WEBHOOK_URL"]!, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                content: `${ctx.body.url.replace("https://x.com", "https://fixupx.com")}`,
                allowed_mentions: {
                    parse: [],
                },
                username: user.username,
                avatar_url,
            }),
        });
        
        return "ok";
    }, {
        body: t.Object({
            url: t.String(),
            auth_string: t.String(), //format: "user_id:real_secret"
        })
    });

elysia.listen(33121);