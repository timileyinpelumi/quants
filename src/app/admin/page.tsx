import { Header } from "@/web/ui/Header";
import { AdminApp } from "@/web/admin/AdminApp";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <div className="flex-1 bg-stake">
      <Header active="admin" />
      <AdminApp />
    </div>
  );
}
