import { createFileRoute } from "@tanstack/react-router"
import { PetWindow } from "@/components/pet/PetWindow"

export const Route = createFileRoute("/pet")({
  component: PetWindow,
})
