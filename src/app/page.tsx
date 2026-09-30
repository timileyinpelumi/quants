import { Header } from "@/web/ui/Header";

export default function LaunchPage() {
  return (
    <div className="min-h-screen bg-launch">
      <Header active="launch" />
      <main className="px-4 md:px-16 py-14">
        <h1 className="font-display font-black text-5xl md:text-6xl tracking-tight">Launch a token.</h1>
      </main>
    </div>
  );
}
