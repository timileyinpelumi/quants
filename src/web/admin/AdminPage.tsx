import type { Metadata } from "next";
import { Header } from "@/web/ui/Header";
import { AdminApp } from "./AdminApp";

export const adminMetadata: Metadata = { title: "quants", robots: { index: false, follow: false, nocache: true } };

/** Served at unlisted paths only. It renders no admin data itself: everything loads from the API after sign in. */
export function AdminPage() {
  return (
    <div className="flex-1 bg-stake-page">
      <Header active="admin" />
      <AdminApp />
    </div>
  );
}
