import { createFileRoute } from "@tanstack/react-router";
import AnakPtk from "@/pages/kepegawaian/AnakPtk";

export const Route = createFileRoute("/_protected/_app/kepegawaian/anak-ptk")({
  component: AnakPtk,
});
