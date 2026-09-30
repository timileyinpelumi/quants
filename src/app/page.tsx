import { Header } from "@/web/ui/Header";
import { LaunchForm } from "@/web/launch/LaunchForm";
import { getContext } from "@/web/server/context";
import { loadLatestSettings } from "@/domain/settings";

export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const s = await loadLatestSettings(getContext().sql);
  return (
    <div className="flex-1 bg-launch">
      <Header active="launch" />
      <LaunchForm split={s.split} tiers={s.tiers} launchFeeLamports={s.launchFeeLamports.toString()} maxPenaltyBps={s.maxPenaltyBps} />
    </div>
  );
}
