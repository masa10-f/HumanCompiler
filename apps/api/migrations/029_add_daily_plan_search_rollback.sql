-- Roll back the new API before removing its search column. Notes remain intact.
DROP TRIGGER daily_plan_search_text_on_write ON public.daily_plan_documents;
DROP FUNCTION public.refresh_daily_plan_search_text();
DROP FUNCTION public.daily_plan_search_text(jsonb);
ALTER TABLE public.daily_plan_documents DROP COLUMN search_text;
