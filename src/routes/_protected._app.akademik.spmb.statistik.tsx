import { createFileRoute } from "@tanstack/react-router";
import SPMB from "@/pages/akademik/SPMB";

function StatisticsPage() { return <SPMB view="statistics" />; }
export const Route = createFileRoute("/_protected/_app/akademik/spmb/statistik")({ component: StatisticsPage });
