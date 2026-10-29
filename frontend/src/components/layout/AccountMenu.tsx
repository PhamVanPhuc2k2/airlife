"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { useLogout, useMe } from "@/lib/auth";

// Góc phải header: chưa đăng nhập → nút "Đăng nhập"; đã đăng nhập → avatar mở menu.
// Radix DropdownMenu lo bàn phím (mũi tên lên/xuống, Esc), focus, và nhãn cho trình đọc màn hình.
export function AccountMenu() {
  const { me, isLoading } = useMe();
  const logout = useLogout();
  const router = useRouter();
  const pathname = usePathname();

  if (isLoading) {
    // Đang hỏi /auth/me: giữ chỗ đúng cỡ để header không bị giật khi có kết quả
    return <span className="size-10" aria-hidden="true" />;
  }
  if (!me) {
    return (
      <Link
        href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
        className="icon-btn"
        aria-label="Đăng nhập"
      >
        <Icon name="user" className="size-[22px]" />
      </Link>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Tài khoản"
        className="ml-1 rounded-full transition hover:ring-2 hover:ring-brand-500 data-[state=open]:ring-2 data-[state=open]:ring-brand-500"
      >
        <Avatar name={me.display_name} size="sm" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-[110] min-w-[240px] rounded-[14px] bg-surface p-2 shadow-lg ring-1 ring-ink/[0.14]"
        >
          <div className="px-3 py-2">
            <p className="font-semibold">{me.display_name}</p>
            <p className="truncate text-sm text-ink-muted">{me.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-ink/[0.07]" />
          <MenuLink href="/ban" icon="user" label="Trang của bạn" />
          <MenuLink href="/suu-tap" icon="library" label="Sưu tập" />
          <DropdownMenu.Separator className="my-1 h-px bg-ink/[0.07]" />
          <DropdownMenu.Item
            onSelect={() =>
              logout.mutate(undefined, {
                onSettled: () => {
                  router.push("/");
                  router.refresh();
                },
              })
            }
            className="flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
          >
            <Icon name="logout" />
            Đăng xuất
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    // asChild: Radix gắn hành vi mục menu lên chính thẻ <Link>, không bọc thêm thẻ nào
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
      >
        <Icon name={icon} />
        {label}
      </Link>
    </DropdownMenu.Item>
  );
}
