import { createFileRoute } from "@tanstack/react-router"
import { PetWindow } from "@/pet/PetWindow"

export const Route = createFileRoute("/pet")({
  component: PetWindow,
})
