const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require("axios");
const express = require("express");

// Configuration
const RPC_URL = "https://api.mainnet-beta.solana.com";
const walletAddress = new PublicKey("GB4hy7secjChACoTA9Qv2NJgdnnDFfCCKdSbiLWznmSV");
const discordWebhook = "https://discord.com/api/webhooks/1359259043415457852/JYOfu2QO-lB6iiJD5CzrvVnbnenbBA03IHkFfjRQCimRGHpIcEqLet4f8I0Gm0fVcQJx";
const connection = new Connection(RPC_URL, 'confirmed');
const UPDATE_INTERVAL = 45; // Check every 45 seconds
const MIN_TOKEN_AMOUNT = 0.000001;

// Market cap thresholds for notifications
const MC_THRESHOLDS = {
  FIRST: 5000,   // 5k
  SECOND: 10000  // 10k
};

// Track tokens we've already seen and reported
let knownTokens = new Set(); // Set of mint addresses we've already seen 
let notifiedMilestones = {}; // Track tokens and which milestones have been notified
let tokenData = {}; // Store latest token data

// Emojis for better readability
const EMOJIS = {
  milestone5k: "🚀",
  milestone10k: "🌕",
  alert: "⚠️"
};

async function getTokenAccounts() {
  try {
    console.log("Fetching token accounts for wallet:", walletAddress.toString());

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletAddress, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
    });

    console.log(`Found ${tokenAccounts.value.length} raw token accounts`);

    if (tokenAccounts.value.length > 0) {
      const validTokens = tokenAccounts.value
        .map(account => {
          try {
            return {
              mint: account.account.data.parsed.info.mint,
              amount: Number(account.account.data.parsed.info.tokenAmount.uiAmount),
              decimals: account.account.data.parsed.info.tokenAmount.decimals
            };
          } catch (err) {
            console.error("Error parsing token account:", err);
            return null;
          }
        })
        .filter(token => token !== null && token.amount > MIN_TOKEN_AMOUNT);

      console.log(`Found ${validTokens.length} tokens with non-zero balances`);
      return validTokens;
    }

    console.log("No tokens found in wallet");
    return [];
  } catch (err) {
    console.error("Error fetching token accounts:", err);
    return [];
  }
}

async function getDexScreenerData(mint) {
  try {
    console.log(`Fetching DEXScreener data for mint: ${mint}`);
    const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);

    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      const sortedPairs = response.data.pairs.sort((a, b) => 
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      );

      return sortedPairs[0];
    }

    console.log(`No DEXScreener data found for mint: ${mint}`);
    return null;
  } catch (error) {
    console.error(`Error fetching DEXScreener data for ${mint}:`, error.message);
    return null;
  }
}

async function sendDiscordMessage(content) {
  try {
    console.log("Sending Discord message");

    if (typeof content === 'string') {
      await axios.post(discordWebhook, { content });
    } else {
      await axios.post(discordWebhook, content);
    }

    console.log("Discord message sent successfully");
  } catch (err) {
    console.error("Failed to send Discord message:", err.message);
  }
}

function formatMilestoneMessage(symbol, mc, milestone) {
  const threshold = milestone === 'FIRST' ? MC_THRESHOLDS.FIRST : MC_THRESHOLDS.SECOND;
  const emoji = milestone === 'FIRST' ? EMOJIS.milestone5k : EMOJIS.milestone10k;

  return {
    embeds: [{
      title: `${emoji} MILESTONE ALERT ${emoji}`,
      description: `**${symbol}** just reached a **$${Number(threshold).toLocaleString()}** Market Cap!`,
      color: milestone === 'FIRST' ? 0x00FF00 : 0xFFD700,
      fields: [
        {
          name: "Token Details:",
          value: `Market Cap: $${Number(mc).toLocaleString()}\n` +
                 `This is a significant milestone!`
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: `Track this token closely! It's showing momentum!`
      }
    }]
  };
}

async function trackWallet() {
  try {
    console.log("Starting wallet tracking...");
    const tokens = await getTokenAccounts();

    const notificationPromises = [];

    for (const token of tokens) {
      const data = await getDexScreenerData(token.mint);

      if (!data) continue;

      const symbol = data.baseToken?.symbol || "Unknown";
      const price = data.priceUsd || 0;
      const mc = data.fdv || 0;
      const volume = data.volume?.h24 || 0;
      const liquidity = data.liquidity?.usd || 0;
      const priceChange24h = data.priceChange?.h24 || 0;

      console.log(`Token: ${symbol}, Price: $${price}, MC: $${mc}, Amount: ${token.amount}`);

      tokenData[token.mint] = {
        symbol,
        price,
        mc,
        volume,
        liquidity,
        priceChange24h,
        amount: token.amount,
        value: token.amount * price
      };

      if (!notifiedMilestones[token.mint]) {
        notifiedMilestones[token.mint] = {
          FIRST: false,
          SECOND: false
        };
      }

      if (mc >= MC_THRESHOLDS.SECOND && !notifiedMilestones[token.mint].SECOND) {
        notificationPromises.push(
          sendDiscordMessage(formatMilestoneMessage(symbol, mc, 'SECOND'))
        );
        notifiedMilestones[token.mint].SECOND = true;
        notifiedMilestones[token.mint].FIRST = true;
        console.log(`Sending 10k milestone notification for ${symbol}`);
      } 
      else if (mc >= MC_THRESHOLDS.FIRST && !notifiedMilestones[token.mint].FIRST) {
        notificationPromises.push(
          sendDiscordMessage(formatMilestoneMessage(symbol, mc, 'FIRST'))
        );
        notifiedMilestones[token.mint].FIRST = true;
        console.log(`Sending 5k milestone notification for ${symbol}`);
      }
    }

    tokens.forEach(token => knownTokens.add(token.mint));

    await Promise.all(notificationPromises);

    console.log("Wallet tracking completed");
  } catch (error) {
    console.error("Error tracking wallet:", error);
    await sendDiscordMessage({
      embeds: [{
        title: `${EMOJIS.alert} Error Tracking Wallet ${EMOJIS.alert}`,
        description: "An error occurred while fetching token data: " + error.message,
        color: 0xFF0000,
        timestamp: new Date().toISOString()
      }]
    });
  }
}

console.log(`Started tracking tokens for wallet ${walletAddress.toString()}...`);
console.log(`Checking tokens every ${UPDATE_INTERVAL} seconds in the background`);
console.log(`Will notify ONLY when tokens reach ${MC_THRESHOLDS.FIRST} or ${MC_THRESHOLDS.SECOND} market cap`);

trackWallet();
const scheduleJob = setInterval(trackWallet, UPDATE_INTERVAL * 1000);

const app = express();
const PORT = 5000;

app.get('/', (req, res) => {
  res.json({
    status: 'active',
    wallet: walletAddress.toString(),
    lastUpdate: new Date().toISOString(),
    marketCapThresholds: MC_THRESHOLDS,
    updateInterval: `${UPDATE_INTERVAL} seconds`,
    knownTokensCount: knownTokens.size,
    trackedTokensCount: Object.keys(tokenData).length
  });
});

app.get('/tokens', (req, res) => {
  const formattedTokens = Object.entries(tokenData).map(([mint, data]) => {
    return {
      mint,
      symbol: data.symbol,
      price: `$${Number(data.price).toLocaleString(undefined, {maximumFractionDigits: 8})}`,
      marketCap: `$${Number(data.mc).toLocaleString()}`,
      priceChange24h: `${data.priceChange24h > 0 ? '+' : ''}${data.priceChange24h.toFixed(2)}%`,
      amount: data.amount.toLocaleString(undefined, {maximumFractionDigits: 6}),
      value: `$${data.value.toLocaleString(undefined, {maximumFractionDigits: 2})}`,
      volume24h: `$${Number(data.volume).toLocaleString()}`,
      liquidity: `$${Number(data.liquidity).toLocaleString()}`
    };
  });

  res.json({
    totalTokens: formattedTokens.length,
    tokens: formattedTokens
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});