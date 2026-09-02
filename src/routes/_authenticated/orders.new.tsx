import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSection } from "@/components/commerce/FormSection";
import { OrderProductPicker } from "@/components/orders/OrderProductPicker";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import { createOrder, isPlausibleBdPhone } from "@/lib/orders";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  calculateOrderTotals,
  lineTotal,
} from "@/types/orders";
import type { DraftOrderItem, PaymentMethod } from "@/types/orders";

const TITLE = "New Order · Commerce Operations";
const DESCRIPTION = "Create a customer order with snapshot pricing and delivery details.";

export const Route = createFileRoute("/_authenticated/orders/new")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const numberOr0 = (v: string) => {
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function Page() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const [recipientName, setRecipientName] = useState("");
  const [addressPhone, setAddressPhone] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [area, setArea] = useState("");
  const [district, setDistrict] = useState("");
  const [division, setDivision] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("Bangladesh");

  const [items, setItems] = useState<DraftOrderItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cod");
  const [orderDiscount, setOrderDiscount] = useState("0");
  const [shippingCharge, setShippingCharge] = useState("0");
  const [adjustment, setAdjustment] = useState("0");
  const [paidAmount, setPaidAmount] = useState("0");
  const [deliveryCharge, setDeliveryCharge] = useState("0");
  const [packingCharge, setPackingCharge] = useState("0");
  const [note, setNote] = useState("");

  const charges = {
    orderDiscount: numberOr0(orderDiscount),
    shippingCharge: numberOr0(shippingCharge),
    adjustment: numberOr0(adjustment),
    paidAmount: numberOr0(paidAmount),
    deliveryCharge: numberOr0(deliveryCharge),
    packingCharge: numberOr0(packingCharge),
  };

  const totals = useMemo(() => calculateOrderTotals(items, charges), [items, charges]);

  const mutation = useMutation({
    mutationFn: (status: "draft" | "created") =>
      createOrder({
        status,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim() || null,
        address: {
          recipientName: recipientName.trim() || customerName.trim(),
          phone: addressPhone.trim() || customerPhone.trim(),
          addressLine: addressLine.trim(),
          area: area.trim(),
          district: district.trim(),
          division: division.trim(),
          postalCode: postalCode.trim(),
          country: country.trim() || "Bangladesh",
        },
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          discountAmount: i.discountAmount,
        })),
        paymentMethod,
        ...charges,
        note: note.trim(),
      }),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`Order ${order.order_number} saved`);
      void navigate({ to: "/orders/$id", params: { id: order.id } });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save order"),
  });

  function validate(): string | null {
    if (!customerName.trim()) return "Customer name is required.";
    if (!customerPhone.trim()) return "Customer phone is required.";
    if (!isPlausibleBdPhone(customerPhone)) return "Enter a valid Bangladesh mobile number.";
    if (!addressLine.trim()) return "Shipping address is required.";
    if (items.length === 0) return "Add at least one product.";
    if (items.some((i) => i.quantity < 1)) return "Quantity must be at least 1.";
    if (items.some((i) => i.discountAmount > i.quantity * i.unitPrice))
      return "An item discount is larger than its line value.";
    if (totals.grandTotal < 0) return "Grand total cannot be negative.";
    return null;
  }

  function submit(status: "draft" | "created") {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    mutation.mutate(status);
  }

  function patchItem(key: string, patch: Partial<DraftOrderItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  if (!canManage) {
    return (
      <>
        <PageHeader title="New order" description={DESCRIPTION} />
        <p className="text-[13px] text-muted-foreground">
          Your role can view orders but cannot create them.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New order"
        description={DESCRIPTION}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="h-8">
              <Link to="/orders">
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Orders
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={mutation.isPending}
              onClick={() => submit("draft")}
            >
              Save draft
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={mutation.isPending}
              onClick={() => submit("created")}
            >
              Create order
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <FormSection title="Customer" description="Stored as a snapshot on this order.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" required>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </Field>
              <Field label="Phone" required>
                <Input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="h-8 text-[13px]"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Shipping address"
            description="Frozen on the order. Future customer address edits will not change it."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Recipient name">
                <Input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Same as customer"
                  className="h-8 text-[13px]"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={addressPhone}
                  onChange={(e) => setAddressPhone(e.target.value)}
                  placeholder="Same as customer"
                  className="h-8 text-[13px]"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address" required>
                  <Textarea
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    rows={2}
                    className="text-[13px]"
                  />
                </Field>
              </div>
              <Field label="Area">
                <Input value={area} onChange={(e) => setArea(e.target.value)} className="h-8 text-[13px]" />
              </Field>
              <Field label="District">
                <Input
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </Field>
              <Field label="Division">
                <Input
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </Field>
              <Field label="Postal code">
                <Input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </Field>
              <Field label="Country">
                <Input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Products"
            description="A variable product must be ordered by variant."
          >
            <OrderProductPicker
              onAdd={(item) =>
                setItems((prev) => {
                  const key = `${item.productId}:${item.variantId ?? "-"}`;
                  const existing = prev.find((i) => i.key === key);
                  if (existing) {
                    return prev.map((i) =>
                      i.key === key ? { ...i, quantity: i.quantity + 1 } : i,
                    );
                  }
                  return [...prev, { ...item, key }];
                })
              }
            />

            <div className="mt-3 overflow-x-auto rounded border border-border">
              <table className="w-full text-[13px]">
                <thead className="border-b border-border bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">SKU</th>
                    <th className="px-3 py-2 text-right font-medium">Unit price</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Discount</th>
                    <th className="px-3 py-2 text-right font-medium">Line total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                        No items yet.
                      </td>
                    </tr>
                  )}
                  {items.map((i) => (
                    <tr key={i.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{i.productName}</p>
                        {i.variantName && (
                          <p className="text-[11.5px] text-muted-foreground">{i.variantName}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{i.sku ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(i.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={1}
                          value={i.quantity}
                          onChange={(e) =>
                            patchItem(i.key, {
                              quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                            })
                          }
                          className="ml-auto h-7 w-16 text-right text-[13px]"
                          aria-label={`Quantity for ${i.productName}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={0}
                          value={i.discountAmount}
                          onChange={(e) =>
                            patchItem(i.key, {
                              discountAmount: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="ml-auto h-7 w-20 text-right text-[13px]"
                          aria-label={`Discount for ${i.productName}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(lineTotal(i))}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setItems((prev) => prev.filter((x) => x.key !== i.key))}
                          aria-label={`Remove ${i.productName}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>

          <FormSection title="Order note" description="Optional. Saved with the order timeline.">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="text-[13px]"
              placeholder="Anything the operations team should know"
            />
          </FormSection>
        </div>

        <div className="space-y-4">
          <FormSection title="Payment">
            <Field label="Method">
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Paid amount">
              <Input
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="h-8 text-[13px]"
              />
            </Field>
          </FormSection>

          <FormSection title="Charges (customer)">
            <Field label="Order discount">
              <Input
                value={orderDiscount}
                onChange={(e) => setOrderDiscount(e.target.value)}
                className="h-8 text-[13px]"
              />
            </Field>
            <Field label="Shipping charge">
              <Input
                value={shippingCharge}
                onChange={(e) => setShippingCharge(e.target.value)}
                className="h-8 text-[13px]"
              />
            </Field>
            <Field label="Manual adjustment">
              <Input
                value={adjustment}
                onChange={(e) => setAdjustment(e.target.value)}
                className="h-8 text-[13px]"
                placeholder="Can be negative"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Internal cost"
            description="Operational cost only. Never shown to the customer."
          >
            <Field label="Delivery cost">
              <Input
                value={deliveryCharge}
                onChange={(e) => setDeliveryCharge(e.target.value)}
                className="h-8 text-[13px]"
              />
            </Field>
            <Field label="Packing cost">
              <Input
                value={packingCharge}
                onChange={(e) => setPackingCharge(e.target.value)}
                className="h-8 text-[13px]"
              />
            </Field>
          </FormSection>

          <div className="rounded border border-border p-3 text-[13px]">
            <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
            <Row label="Item discount" value={`− ${formatMoney(totals.productDiscount)}`} />
            <Row label="Order discount" value={`− ${formatMoney(totals.orderDiscount)}`} />
            <Row label="Shipping charge" value={formatMoney(totals.shippingCharge)} />
            <Row label="Adjustment" value={formatMoney(totals.adjustment)} />
            <div className="my-2 border-t border-border" />
            <Row label="Grand total" value={formatMoney(totals.grandTotal)} strong />
            <Row label="Paid" value={formatMoney(totals.paidAmount)} />
            <Row label="Due" value={formatMoney(totals.dueAmount)} />
            <div className="my-2 border-t border-dashed border-border" />
            <Row label="Internal cost" value={formatMoney(totals.internalCost)} muted />
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Totals are recalculated by the database when the order is saved.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Label className="block space-y-1">
      <span className="block text-[12px] font-normal text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </Label>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={muted ? "text-muted-foreground" : "text-muted-foreground"}>{label}</span>
      <span
        className={
          strong
            ? "font-semibold tabular-nums text-foreground"
            : muted
              ? "tabular-nums text-muted-foreground"
              : "tabular-nums text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
