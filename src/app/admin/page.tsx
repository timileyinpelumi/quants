import { Header } from "@/web/ui/Header";
import { AdminApp } from "@/web/admin/AdminApp";
import { quoteCoins } from "@/domain/quotes";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <div className="flex-1 bg-stake-page">
      <Header active="admin" />
      <AdminApp pairs={quoteCoins().map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, graduation: c.graduation }))} />
    </div>
  );
}
