import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { AutomationRuleInput } from "@/lib/automation";
import type {
  AutomationCondition,
  AutomationFieldType,
  AutomationRegistry,
  AutomationRule,
} from "@/types/automation";
import { AUTOMATION_ACTION_LABELS, AUTOMATION_OPERATOR_LABELS } from "@/types/automation";
import type { AssignableStaff } from "@/lib/operations";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registry: AutomationRegistry | undefined;
  staff: AssignableStaff[];
  rule: AutomationRule | null;
  isSaving: boolean;
  onSubmit: (input: AutomationRuleInput) => void;
}

interface DraftCondition {
  field: string;
  operator: string;
  value: string;
}

const VERIFICATION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export function AutomationRuleDialog({
  open,
  onOpenChange,
  registry,
  staff,
  rule,
  isSaving,
  onSubmit,
}: Props) {
  const triggerNames = useMemo(
    () => (registry ? Object.keys(registry.triggers).sort() : []),
    [registry],
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState("");
  const [mode, setMode] = useState("all");
  const [priority, setPriority] = useState("normal");
  const [conditions, setConditions] = useState<DraftCondition[]>([]);
  const [action, setAction] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (rule) {
      setName(rule.name);
      setDescription(rule.description ?? "");
      setTrigger(rule.trigger_type);
      setMode(rule.condition_mode);
      setPriority(rule.priority);
      setAction(rule.action_type);
      setConditions(
        (rule.conditions ?? []).map((c) => ({
          field: c.field,
          operator: c.operator,
          value: Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? ""),
        })),
      );
      setConfig(
        Object.fromEntries(
          Object.entries(rule.action_config ?? {}).map(([k, v]) => [k, String(v ?? "")]),
        ),
      );
    } else {
      setName("");
      setDescription("");
      setTrigger(triggerNames[0] ?? "");
      setMode("all");
      setPriority("normal");
      setConditions([]);
      setAction("");
      setConfig({});
    }
  }, [open, rule, triggerNames]);

  const triggerDef = registry && trigger ? registry.triggers[trigger] : undefined;
  const fields = useMemo(
    () => (triggerDef ? Object.keys(triggerDef.fields).sort() : []),
    [triggerDef],
  );
  const actions = triggerDef?.actions ?? [];

  useEffect(() => {
    if (!triggerDef) return;
    if (!actions.includes(action as never)) {
      setAction(actions[0] ?? "");
      setConfig({});
    }
    setConditions((prev) => prev.filter((c) => triggerDef.fields[c.field]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  function fieldType(field: string): AutomationFieldType {
    return (triggerDef?.fields[field] ?? "text") as AutomationFieldType;
  }

  function defaultValueFor(field: string): string {
    return fieldType(field) === "boolean" ? "true" : "";
  }

  function operatorsFor(field: string): string[] {
    return registry?.operators[fieldType(field)] ?? [];
  }

  function parseValue(condition: DraftCondition): unknown {
    const type = fieldType(condition.field);
    if (condition.operator === "exists") return undefined;
    if (condition.operator === "in" || condition.operator === "not_in") {
      return condition.value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (type === "number" ? Number(v) : type === "boolean" ? v === "true" : v));
    }
    if (type === "number") return Number(condition.value);
    if (type === "boolean") return condition.value === "true";
    return condition.value;
  }

  function submit() {
    setError(null);
    if (!name.trim()) return setError("A rule name is required.");
    if (!trigger) return setError("Choose a trigger.");
    if (!action) return setError("Choose an action.");

    const built: AutomationCondition[] = [];
    for (const c of conditions) {
      if (!c.field || !c.operator) return setError("Every condition needs a field and operator.");
      if (c.operator !== "exists" && c.value.trim() === "")
        return setError(`A comparison value is required for ${c.field}.`);
      if (
        fieldType(c.field) === "number" &&
        c.operator !== "in" &&
        c.operator !== "not_in" &&
        Number.isNaN(Number(c.value))
      )
        return setError(`${c.field} needs a numeric value.`);
      const parsed = parseValue(c);
      built.push(
        c.operator === "exists"
          ? { field: c.field, operator: c.operator }
          : { field: c.field, operator: c.operator, value: parsed },
      );
    }

    const actionConfig: Record<string, unknown> = {};
    if (action === "set_verification_priority") {
      if (!config["priority"]) return setError("Choose a verification priority.");
      actionConfig["priority"] = config["priority"];
    } else if (action === "move_to_manual_review") {
      if (!config["reason"]?.trim()) return setError("A manual review reason is required.");
      actionConfig["reason"] = config["reason"].trim();
    } else if (action === "assign_operational_work") {
      if (!config["assigned_to"]) return setError("Choose who the work is assigned to.");
      actionConfig["assigned_to"] = config["assigned_to"];
      if (config["note"]?.trim()) actionConfig["note"] = config["note"].trim();
    } else if (action === "create_internal_note") {
      if (!config["note"]?.trim()) return setError("A note is required.");
      actionConfig["note"] = config["note"].trim();
    }

    const input: AutomationRuleInput = {
      name: name.trim(),
      description: description.trim() || null,
      trigger_type: trigger,
      condition_mode: mode,
      conditions: built,
      action_type: action,
      action_config: actionConfig,
      priority,
    };
    if (rule) input.id = rule.id;
    onSubmit(input);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit automation rule" : "New automation rule"}</DialogTitle>
          <DialogDescription>
            Rules react to real operational events and run controlled actions only. They never
            bypass existing workflow validation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">Name</Label>
              <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Rule priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["low", "normal", "high"].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-description">Description</Label>
            <Textarea
              id="rule-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={trigger} onValueChange={setTrigger}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a trigger" />
                </SelectTrigger>
                <SelectContent>
                  {triggerNames.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Condition mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Match all conditions</SelectItem>
                  <SelectItem value="any">Match any condition</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded border border-border p-3">
            <div className="flex items-center justify-between">
              <Label>Conditions</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!triggerDef || conditions.length >= 10}
                onClick={() =>
                  setConditions((prev) => [
                    ...prev,
                    {
                      field: fields[0] ?? "",
                      operator: operatorsFor(fields[0] ?? "")[0] ?? "",
                      value: defaultValueFor(fields[0] ?? ""),
                    },
                  ])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add condition
              </Button>
            </div>
            {conditions.length === 0 && (
              <p className="text-[13px] text-muted-foreground">
                No conditions — the rule runs on every matching event.
              </p>
            )}
            {conditions.map((condition, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Select
                  value={condition.field}
                  onValueChange={(field) =>
                    setConditions((prev) =>
                      prev.map((c, i) =>
                        i === index
                          ? {
                              field,
                              operator: operatorsFor(field)[0] ?? "",
                              value: defaultValueFor(field),
                            }
                          : c,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={condition.operator}
                  onValueChange={(operator) =>
                    setConditions((prev) =>
                      prev.map((c, i) => (i === index ? { ...c, operator } : c)),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {operatorsFor(condition.field).map((op) => (
                      <SelectItem key={op} value={op}>
                        {AUTOMATION_OPERATOR_LABELS[op] ?? op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {condition.operator === "exists" ? (
                  <div className="flex items-center text-[13px] text-muted-foreground">
                    no value needed
                  </div>
                ) : fieldType(condition.field) === "boolean" &&
                  condition.operator !== "in" &&
                  condition.operator !== "not_in" ? (
                  <Select
                    value={condition.value || "true"}
                    onValueChange={(value) =>
                      setConditions((prev) =>
                        prev.map((c, i) => (i === index ? { ...c, value } : c)),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={condition.value}
                    placeholder={
                      condition.operator === "in" || condition.operator === "not_in"
                        ? "comma separated"
                        : "value"
                    }
                    onChange={(e) =>
                      setConditions((prev) =>
                        prev.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)),
                      )
                    }
                  />
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded border border-border p-3">
            <div className="space-y-1.5">
              <Label>Action</Label>
              <Select
                value={action}
                onValueChange={(value) => {
                  setAction(value);
                  setConfig({});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose an action" />
                </SelectTrigger>
                <SelectContent>
                  {actions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUTOMATION_ACTION_LABELS[a] ?? a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {action === "set_verification_priority" && (
              <div className="space-y-1.5">
                <Label>Verification priority</Label>
                <Select
                  value={config["priority"] ?? ""}
                  onValueChange={(value) => setConfig({ priority: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {VERIFICATION_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {action === "move_to_manual_review" && (
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Input
                  value={config["reason"] ?? ""}
                  onChange={(e) => setConfig({ reason: e.target.value })}
                />
              </div>
            )}

            {action === "assign_operational_work" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Assign to</Label>
                  <Select
                    value={config["assigned_to"] ?? ""}
                    onValueChange={(value) =>
                      setConfig((prev) => ({ ...prev, assigned_to: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name ?? member.id.slice(0, 8)} · {member.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Note (optional)</Label>
                  <Input
                    value={config["note"] ?? ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, note: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {action === "create_internal_note" && (
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea
                  rows={2}
                  value={config["note"] ?? ""}
                  onChange={(e) => setConfig({ note: e.target.value })}
                />
              </div>
            )}
          </div>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {isSaving ? "Saving…" : rule ? "Save changes" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
