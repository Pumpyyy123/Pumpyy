const axios = require("axios");
const { Connection, PublicKey } = require("@solana/web3.js");

const WALLET_ADDRESS = "9TEKUFgQSdQd3HxXcWEM2TCJiXb3nMZRSJBvg5AC3gFu";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const RAYDIUM_API = "https://api.raydium.io/v2/sdk/token/price";
const connection = new Connection(SOLANA_RPC, "confirmed");

let tokenPrices = {};

async function getTokenAccounts() {
    const publicKey = new PublicKey(WALLET_ADDRESS);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
    return tokenAccounts.value.map((account) => ({
        mint: account.account.data.parsed.info.mint,
        amount: account.account.data.parsed.info.tokenAmount.uiAmount
    }));
}

async function fetchPrices() {
    try {
        const response = await axios.get(RAYDIUM_API);
        tokenPrices = response.data;
    } catch (error) {
        console.error("Error fetching prices:", error);
    }
}

async function trackWallet() {
    await fetchPrices();
    const tokens = await getTokenAccounts();
    console.clear();
    console.log("Tracking Wallet:", WALLET_ADDRESS);
    tokens.forEach((token) => {
        const mint = token.mint;
        const balance = token.amount;
        const price = tokenPrices[mint] ? tokenPrices[mint].price : "Unknown";
        console.log(Token: ${mint} | Balance: ${balance} | Price: ${price});
    });
}

setInterval(trackWallet, 10000);
trackWallet();
