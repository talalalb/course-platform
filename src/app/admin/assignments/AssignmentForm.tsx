import { ActionForm, SubmitButton, type ActionState } from '@/components/forms';
import { appTimeZone, utcToZonedInput } from '@/lib/time';

type Values = {
  id?: string;
  courseId: string;
  title: string;
  description: string;
  dueAt: Date;
  maxScore: number;
  allowLate: boolean;
  isPublished: boolean;
};

export function AssignmentForm({
  action,
  values,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  values: Values;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="courseId" value={values.courseId} />
      {values.id ? <input type="hidden" name="assignmentId" value={values.id} /> : null}
      <div>
        <label className="label" htmlFor="title">
          عنوان الواجب
        </label>
        <input id="title" name="title" className="field" defaultValue={values.title} required maxLength={200} />
      </div>
      <div>
        <label className="label" htmlFor="description">
          المطلوب من الطالب
        </label>
        <textarea id="description" name="description" className="field" rows={7} defaultValue={values.description} maxLength={10000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="dueAt">
            آخر موعد للتسليم <span className="text-xs text-gray-400">(بتوقيت {appTimeZone() === 'Asia/Riyadh' ? 'الرياض' : appTimeZone()})</span>
          </label>
          <input id="dueAt" name="dueAt" type="datetime-local" className="field ltr" defaultValue={utcToZonedInput(values.dueAt)} required />
        </div>
        <div>
          <label className="label" htmlFor="maxScore">
            الدرجة الكاملة
          </label>
          <input id="maxScore" name="maxScore" type="number" min={1} max={1000} className="field ltr" defaultValue={values.maxScore} required />
        </div>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="allowLate" defaultChecked={values.allowLate} className="h-4 w-4" />
          السماح بالتسليم بعد الموعد (يظهر «متأخر»)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPublished" defaultChecked={values.isPublished} className="h-4 w-4" />
          منشور ويظهر للطلاب
        </label>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
