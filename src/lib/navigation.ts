import {
  Bot,
  Briefcase,
  Inbox,
  LayoutDashboard,
  MessageCircleQuestion,
  Package,
  Settings,
  Store,
  Users,
} from "lucide-react";
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Resumen", icon: LayoutDashboard, exact: true },
  {
    href: "/dashboard/conversaciones",
    label: "Conversaciones",
    icon: Inbox,
  },
  {
    href: "/dashboard/integraciones/whatsapp",
    label: "WhatsApp",
    icon: WhatsappIcon,
  },
  { href: "/dashboard/negocio", label: "Negocio", icon: Store },
  { href: "/dashboard/productos", label: "Productos", icon: Package },
  { href: "/dashboard/servicios", label: "Servicios", icon: Briefcase },
  {
    href: "/dashboard/preguntas",
    label: "Preguntas frecuentes",
    icon: MessageCircleQuestion,
  },
  { href: "/dashboard/agente", label: "Agente IA", icon: Bot },
  { href: "/dashboard/equipo", label: "Equipo", icon: Users },
  {
    href: "/dashboard/configuracion",
    label: "Configuración",
    icon: Settings,
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
