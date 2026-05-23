import * as React from "react"
import { toast } from "sonner"
import { IconPackageImport, IconTrash } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import {
  loadInstalledSkinList,
  type PetSkinInfo,
} from "@/components/pet/pet-loader"
import type { PetVisibilityMode } from "./settings-types"
import {
  getElectronApi,
  isElectron,
  withElectronApi,
} from "@/lib/electron/host"

const DEFAULT_PET_SLUG = "eve"

export function PetSettings() {
  const api = getElectronApi()
  const inElectron = isElectron()

  const [petEnabled, setPetEnabled] = React.useState(true)
  const [petVisibilityMode, setPetVisibilityMode] =
    React.useState<PetVisibilityMode>("when_main_hidden")
  const [petAlwaysOnTop, setPetAlwaysOnTop] = React.useState(true)
  const [selectedSlug, setSelectedSlug] = React.useState(DEFAULT_PET_SLUG)
  const [availablePets, setAvailablePets] = React.useState<PetSkinInfo[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)
  const [uninstallingSlug, setUninstallingSlug] = React.useState<string | null>(
    null
  )

  const refreshPetList = React.useCallback(async () => {
    if (!api) return
    const slug = await api.getSelectedPetSlug()
    setSelectedSlug(slug)
    const pets = await loadInstalledSkinList()
    setAvailablePets(pets)
  }, [api])

  React.useEffect(() => {
    if (!inElectron || !api) return
    void (async () => {
      try {
        const s = await api.getPetSettings()
        setPetEnabled(s.petEnabled)
        setPetVisibilityMode(s.petVisibilityMode)
        setPetAlwaysOnTop(s.petAlwaysOnTop)
        await refreshPetList()
      } catch {
        toast.error("宠物设置加载失败")
      } finally {
        setLoaded(true)
      }
    })()
  }, [api, inElectron, refreshPetList])

  React.useEffect(() => {
    if (!inElectron) return
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshPetList()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [inElectron, refreshPetList])

  const persist = React.useCallback(
    async (partial: {
      petEnabled?: boolean
      petVisibilityMode?: PetVisibilityMode
      petAlwaysOnTop?: boolean
    }) => {
      if (!api?.isElectron) return
      await api.setPetSettings(partial)
    },
    [api]
  )

  const handleInstall = async () => {
    setInstalling(true)
    const result = await withElectronApi(
      (electronApi) => electronApi.installPetFromZip(),
      {
        silent: true,
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "安装失败")
        },
      }
    )
    setInstalling(false)
    if (result?.slug) {
      toast.success(`已安装宠物：${result.displayName}`)
      await api?.setSelectedPetSlug(result.slug)
      await refreshPetList()
    }
  }

  const handleUninstall = async (slug: string, displayName: string) => {
    setUninstallingSlug(slug)
    let failed = false
    await withElectronApi((electronApi) => electronApi.uninstallPet(slug), {
      onError: (error) => {
        failed = true
        const message = error instanceof Error ? error.message : "卸载失败"
        toast.error(message)
      },
    })
    setUninstallingSlug(null)
    if (failed) return

    toast.success(`已卸载宠物：${displayName}`)
    if (selectedSlug === slug) {
      await api?.setSelectedPetSlug(DEFAULT_PET_SLUG)
    }
    await refreshPetList()
  }

  if (!inElectron) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>宠物</CardTitle>
          <CardDescription>桌面宠物与语音快捷入口</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            宠物功能仅在桌面客户端（Electron）中可用。
          </p>
        </CardContent>
      </Card>
    )
  }

  const bundledPets = availablePets.filter((p) => p.source === "bundled")
  const installedPets = availablePets.filter((p) => p.source === "installed")
  const petdexPets = availablePets.filter((p) => p.source === "petdex")
  const selectedInstalled = installedPets.find((p) => p.slug === selectedSlug)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>宠物</CardTitle>
          <CardDescription>控制桌面宠物窗口是否显示及展示策略</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!loaded ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">启用宠物</span>
                  <span className="text-xs text-muted-foreground">
                    关闭后将不再显示桌面宠物窗口
                  </span>
                </div>
                <Switch
                  checked={petEnabled}
                  onCheckedChange={async (checked) => {
                    setPetEnabled(checked)
                    await persist({ petEnabled: checked })
                  }}
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-medium">当前宠物</Label>
                <p className="text-xs text-muted-foreground">
                  内置宠物自动发现；zip 安装到{" "}
                  <code className="text-xs">~/.digital-employee/pets/</code>
                  ；Codex 生态兼容{" "}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={installing}
                  onClick={() => void handleInstall()}
                >
                  <IconPackageImport className="size-4" />
                  {installing ? "安装中…" : "从 zip 安装…"}
                </Button>
                <Select
                  value={selectedSlug}
                  onValueChange={async (v) => {
                    setSelectedSlug(v)
                    await api?.setSelectedPetSlug(v)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>内置</SelectLabel>
                      {bundledPets.map((p) => (
                        <SelectItem key={p.slug} value={p.slug}>
                          {p.displayName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {installedPets.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>已安装</SelectLabel>
                        {installedPets.map((p) => (
                          <SelectItem key={p.slug} value={p.slug}>
                            {p.displayName}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {petdexPets.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Codex 兼容</SelectLabel>
                        {petdexPets.map((p) => (
                          <SelectItem key={p.slug} value={p.slug}>
                            {p.displayName}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                {selectedInstalled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={uninstallingSlug === selectedInstalled.slug}
                    onClick={() =>
                      void handleUninstall(
                        selectedInstalled.slug,
                        selectedInstalled.displayName
                      )
                    }
                  >
                    <IconTrash className="size-4" />
                    {uninstallingSlug === selectedInstalled.slug
                      ? "卸载中…"
                      : `卸载 ${selectedInstalled.displayName}`}
                  </Button>
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-medium">展示策略</Label>
                <p className="text-xs text-muted-foreground">
                  「始终显示」时主窗口在前台也会显示宠物；「仅后台时显示」在主窗口最小化或关闭到托盘时显示宠物。
                </p>
                <RadioGroup
                  value={petVisibilityMode}
                  onValueChange={async (v) => {
                    const m = v as PetVisibilityMode
                    setPetVisibilityMode(m)
                    await persist({ petVisibilityMode: m })
                  }}
                  className="gap-4"
                >
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value="always" id="pet-vis-always" />
                    <Label
                      htmlFor="pet-vis-always"
                      className="cursor-pointer font-normal"
                    >
                      始终显示
                    </Label>
                  </div>
                  <div className="flex items-center gap-3">
                    <RadioGroupItem
                      value="when_main_hidden"
                      id="pet-vis-hidden"
                    />
                    <Label
                      htmlFor="pet-vis-hidden"
                      className="cursor-pointer font-normal"
                    >
                      仅主窗口在后台时显示（最小化或关闭到托盘）
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">宠物窗口置顶</span>
                  <span className="text-xs text-muted-foreground">
                    关闭后主窗口可盖住宠物，减少遮挡干扰
                  </span>
                </div>
                <Switch
                  checked={petAlwaysOnTop}
                  onCheckedChange={async (checked) => {
                    setPetAlwaysOnTop(checked)
                    await persist({ petAlwaysOnTop: checked })
                  }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
