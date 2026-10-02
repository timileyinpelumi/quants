export const shareText = (symbol: string, stakes: boolean) => (stakes ? `${symbol} is trading on quants, where its trading fees pay its stakers.` : `${symbol} is trading on quants.`);
export const xIntent = (text: string, url: string) => `https://x.com/intent/post?${new URLSearchParams({ text, url })}`;
export const telegramShare = (text: string, url: string) => `https://t.me/share/url?${new URLSearchParams({ url, text })}`;
