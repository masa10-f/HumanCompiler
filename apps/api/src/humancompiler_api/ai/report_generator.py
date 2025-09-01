"""Weekly work report generator using OpenAI API"""

import logging
from datetime import datetime, timedelta

from openai import OpenAI
from sqlmodel import Session, select, and_
from sqlalchemy.orm import selectinload

from humancompiler_api.models import (
    Log,
    Task,
    Goal,
    Project,
    TaskStatus,
    WeeklyReportRequest,
    WeeklyReportResponse,
    WeeklyWorkSummary,
    ProjectProgressSummary,
    TaskProgressSummary,
)


class WeeklyReportGenerator:
    """Generate weekly work reports using OpenAI API and work logs"""

    def __init__(self):
        """Initialize the report generator"""
        self.openai_client = None
        self.logger = logging.getLogger(__name__)

    def _get_openai_client(self, api_key: str) -> OpenAI:
        """Get or create OpenAI client with provided API key"""
        if not self.openai_client:
            self.openai_client = OpenAI(api_key=api_key)
        return self.openai_client

    def _get_week_dates(self, week_start_date: str) -> tuple[datetime, datetime]:
        """Get start and end datetime for the week"""
        start_date = datetime.strptime(week_start_date, "%Y-%m-%d")
        end_date = start_date + timedelta(days=6, hours=23, minutes=59, seconds=59)
        return start_date, end_date

    def _get_work_logs_for_week(
        self,
        session: Session,
        user_id: str,
        start_date: datetime,
        end_date: datetime,
        project_ids: list[str] | None = None,
    ) -> list[Log]:
        """Get all work logs for the specified week and optional project filter with eager loading"""
        query = (
            select(Log)
            .options(
                selectinload(Log.task)
                .selectinload(Task.goal)
                .selectinload(Goal.project)
            )
            .join(Task, Log.task_id == Task.id)
            .join(Goal, Task.goal_id == Goal.id)
            .join(Project, Goal.project_id == Project.id)
            .where(
                and_(
                    Project.owner_id == user_id,
                    Log.created_at >= start_date,
                    Log.created_at <= end_date,
                )
            )
        )

        if project_ids:
            query = query.where(Project.id.in_(project_ids))

        return session.exec(query.order_by(Log.created_at.desc())).all()

    def _calculate_task_progress(
        self, task: Task, logs: list[Log]
    ) -> TaskProgressSummary:
        """Calculate progress for a single task"""
        task_logs = [log for log in logs if log.task_id == task.id]
        total_actual_minutes = sum(log.actual_minutes for log in task_logs)

        # Calculate completion percentage based on time spent vs estimated
        estimated_minutes = task.estimate_hours * 60
        if estimated_minutes > 0:
            completion_percentage = min(
                (total_actual_minutes / estimated_minutes) * 100, 100
            )
        else:
            completion_percentage = 100 if task.status == TaskStatus.COMPLETED else 0

        work_log_comments = [
            log.comment for log in task_logs if log.comment and log.comment.strip()
        ]

        return TaskProgressSummary(
            task_id=str(task.id),
            task_title=task.title,
            project_title=task.goal.project.title,
            goal_title=task.goal.title,
            estimated_hours=task.estimate_hours,
            actual_minutes=total_actual_minutes,
            completion_percentage=completion_percentage,
            status=task.status,
            work_logs=work_log_comments,
        )

    def _calculate_project_progress(
        self, project: Project, tasks: list[Task], logs: list[Log]
    ) -> ProjectProgressSummary:
        """Calculate progress for a project"""
        project_tasks = [task for task in tasks if task.goal.project.id == project.id]
        task_summaries = [
            self._calculate_task_progress(task, logs) for task in project_tasks
        ]

        total_estimated_hours = sum(task.estimate_hours for task in project_tasks)
        total_actual_minutes = sum(summary.actual_minutes for summary in task_summaries)
        total_tasks = len(project_tasks)
        completed_tasks = len(
            [task for task in project_tasks if task.status == TaskStatus.COMPLETED]
        )

        if total_tasks > 0:
            completion_percentage = (completed_tasks / total_tasks) * 100
        else:
            completion_percentage = 0

        return ProjectProgressSummary(
            project_id=str(project.id),
            project_title=project.title,
            total_estimated_hours=total_estimated_hours,
            total_actual_minutes=total_actual_minutes,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            completion_percentage=completion_percentage,
            tasks=task_summaries,
        )

    def _calculate_weekly_summary(
        self, logs: list[Log], tasks: list[Task], start_date: datetime
    ) -> WeeklyWorkSummary:
        """Calculate overall weekly work summary"""
        total_actual_minutes = sum(log.actual_minutes for log in logs)
        total_estimated_hours = sum(task.estimate_hours for task in tasks)

        # Get unique tasks that had work done
        worked_task_ids = {log.task_id for log in logs}
        total_tasks_worked = len(worked_task_ids)

        # Count completed tasks among those worked on
        completed_tasks = [
            task
            for task in tasks
            if task.id in worked_task_ids and task.status == TaskStatus.COMPLETED
        ]
        total_completed_tasks = len(completed_tasks)

        # Overall completion percentage
        if total_tasks_worked > 0:
            overall_completion_percentage = (
                total_completed_tasks / total_tasks_worked
            ) * 100
        else:
            overall_completion_percentage = 0

        # Daily breakdown
        daily_breakdown = {}
        for i in range(7):
            day = start_date + timedelta(days=i)
            day_str = day.strftime("%Y-%m-%d")
            day_logs = [log for log in logs if log.created_at.date() == day.date()]
            daily_breakdown[day_str] = sum(log.actual_minutes for log in day_logs)

        # Project breakdown
        project_breakdown = {}
        for log in logs:
            # Get project title through task->goal->project relationship
            if (
                hasattr(log, "task")
                and log.task
                and hasattr(log.task, "goal")
                and log.task.goal
            ):
                project_title = log.task.goal.project.title
                if project_title not in project_breakdown:
                    project_breakdown[project_title] = 0
                project_breakdown[project_title] += log.actual_minutes

        return WeeklyWorkSummary(
            total_actual_minutes=total_actual_minutes,
            total_estimated_hours=total_estimated_hours,
            total_tasks_worked=total_tasks_worked,
            total_completed_tasks=total_completed_tasks,
            overall_completion_percentage=overall_completion_percentage,
            daily_breakdown=daily_breakdown,
            project_breakdown=project_breakdown,
        )

    def _generate_markdown_report_with_ai(
        self,
        api_key: str,
        week_start_date: str,
        work_summary: WeeklyWorkSummary,
        project_summaries: list[ProjectProgressSummary],
        model: str = "gpt-4o-mini",
    ) -> str:
        """Generate markdown report using OpenAI API"""
        client = self._get_openai_client(api_key)

        # Prepare data for AI
        context = {
            "week_start": week_start_date,
            "total_hours": round(work_summary.total_actual_minutes / 60, 2),
            "total_tasks": work_summary.total_tasks_worked,
            "completed_tasks": work_summary.total_completed_tasks,
            "completion_rate": round(work_summary.overall_completion_percentage, 1),
            "daily_hours": {
                day: round(minutes / 60, 2)
                for day, minutes in work_summary.daily_breakdown.items()
            },
            "projects": [],
        }

        for project in project_summaries:
            project_data = {
                "name": project.project_title,
                "total_hours": round(project.total_actual_minutes / 60, 2),
                "completion_rate": round(project.completion_percentage, 1),
                "tasks": [],
            }

            for task in project.tasks:
                if task.actual_minutes > 0:  # Only include tasks with actual work
                    task_data = {
                        "title": task.task_title,
                        "goal": task.goal_title,
                        "hours": round(task.actual_minutes / 60, 2),
                        "progress": round(task.completion_percentage, 1),
                        "status": task.status.value,
                        "highlights": task.work_logs[:3],  # Top 3 work log highlights
                    }
                    project_data["tasks"].append(task_data)

            if project_data["tasks"]:  # Only include projects with actual work
                context["projects"].append(project_data)

        # AI prompt for consistent report generation
        prompt = f"""
あなたはプロジェクトマネージャーです。以下のデータを基に、上司や同僚に提出する週間作業報告書をマークダウン形式で作成してください。

## 作業データ:
```json
{context}
```

## 出力要件:
1. **必ず以下の構成で出力してください:**
   - # 週間作業報告書 ({week_start_date}週)
   - ## 1. 作業時間実績
   - ## 2. タスク進捗率
   - ## 3. プロジェクト別詳細

2. **作業時間実績には以下を含めてください:**
   - 週間合計作業時間
   - 日別作業時間（グラフは不要）
   - プロジェクト別配分時間

3. **タスク進捗率には以下を含めてください:**
   - 全体の完了タスク数/作業対象タスク数
   - 進捗率（パーセンテージ）

4. **プロジェクト別詳細には以下を含めてください:**
   - 各プロジェクトの作業時間
   - そのプロジェクト内での主要タスクの進捗
   - 作業ログから抽出した重要なハイライト（作業内容の要約）

5. **日本語で書き、ビジネス文書として適切な敬語を使用してください**

6. **マークダウン記法を正しく使用してください**

マークダウン形式で報告書を出力してください:
"""

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "あなたは経験豊富なプロジェクトマネージャーです。データを分析して、簡潔で分かりやすい週間作業報告書を作成してください。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
            )

            if response.choices and response.choices[0].message.content:
                return response.choices[0].message.content.strip()
            else:
                self.logger.warning("OpenAI response has no content, using fallback")
                return self._generate_basic_markdown_report(
                    week_start_date, work_summary, project_summaries
                )

        except Exception as e:
            # Log specific error type and details
            error_type = type(e).__name__
            self.logger.error(f"OpenAI API error ({error_type}): {str(e)}")

            # Check for specific OpenAI errors
            if hasattr(e, "response"):
                self.logger.error(f"OpenAI error response: {e.response}")

            error_message = str(e).lower()
            if "rate" in error_message and "limit" in error_message:
                self.logger.warning(
                    "OpenAI rate limit exceeded, using fallback report generation"
                )
            elif "api_key" in error_message or "authentication" in error_message:
                self.logger.error("OpenAI API key authentication failed")
            elif "quota" in error_message:
                self.logger.error("OpenAI quota exceeded")
            else:
                self.logger.error(f"Unexpected OpenAI error: {str(e)}")

            # Always fallback to basic markdown report
            return self._generate_basic_markdown_report(
                week_start_date, work_summary, project_summaries
            )

    def _generate_basic_markdown_report(
        self,
        week_start_date: str,
        work_summary: WeeklyWorkSummary,
        project_summaries: list[ProjectProgressSummary],
    ) -> str:
        """Generate basic markdown report without AI (fallback)"""
        report = f"""# 週間作業報告書 ({week_start_date}週)

## 1. 作業時間実績

- **週間合計作業時間**: {work_summary.total_actual_minutes / 60:.1f}時間
- **作業対象タスク数**: {work_summary.total_tasks_worked}個

### 日別作業時間
"""

        for day, minutes in work_summary.daily_breakdown.items():
            if minutes > 0:
                report += f"- {day}: {minutes / 60:.1f}時間\n"

        report += """
### プロジェクト別作業時間
"""

        for project, minutes in work_summary.project_breakdown.items():
            report += f"- {project}: {minutes / 60:.1f}時間\n"

        report += f"""
## 2. タスク進捗率

- **完了タスク数**: {work_summary.total_completed_tasks}/{work_summary.total_tasks_worked}個
- **進捗率**: {work_summary.overall_completion_percentage:.1f}%

## 3. プロジェクト別詳細

"""

        for project in project_summaries:
            if project.total_actual_minutes > 0:
                report += f"""### {project.project_title}

- **作業時間**: {project.total_actual_minutes / 60:.1f}時間
- **タスク進捗**: {project.completed_tasks}/{project.total_tasks}個完了 ({project.completion_percentage:.1f}%)

#### 主要タスクの進捗

"""

                for task in project.tasks:
                    if task.actual_minutes > 0:
                        report += f"""**{task.task_title}** (ゴール: {task.goal_title})
- 作業時間: {task.actual_minutes / 60:.1f}時間
- 進捗: {task.completion_percentage:.1f}% ({task.status.value})
"""
                        if task.work_logs:
                            report += (
                                "- 作業内容: " + "; ".join(task.work_logs[:2]) + "\n"
                            )
                        report += "\n"

        return report

    def generate_weekly_report(
        self,
        session: Session,
        request: WeeklyReportRequest,
        user_id: str,
        openai_api_key: str,
        openai_model: str = "gpt-4o-mini",
    ) -> WeeklyReportResponse:
        """Generate weekly work report"""
        start_date, end_date = self._get_week_dates(request.week_start_date)

        # Get work logs for the week
        work_logs = self._get_work_logs_for_week(
            session, user_id, start_date, end_date, request.project_ids
        )

        if not work_logs:
            # Handle case with no work logs
            empty_summary = WeeklyWorkSummary(
                total_actual_minutes=0,
                total_estimated_hours=0,
                total_tasks_worked=0,
                total_completed_tasks=0,
                overall_completion_percentage=0,
                daily_breakdown={
                    (start_date + timedelta(days=i)).strftime("%Y-%m-%d"): 0
                    for i in range(7)
                },
                project_breakdown={},
            )

            empty_report = f"""# 週間作業報告書 ({request.week_start_date}週)

## 作業実績なし

この週は作業ログが記録されていません。

- 週間合計作業時間: 0時間
- 作業対象タスク数: 0個
- 完了タスク数: 0個

作業を行った場合は、作業ログの記録をお忘れないようお願いいたします。
"""

            return WeeklyReportResponse(
                week_start_date=request.week_start_date,
                week_end_date=(start_date + timedelta(days=6)).strftime("%Y-%m-%d"),
                work_summary=empty_summary,
                project_summaries=[],
                markdown_report=empty_report,
                generated_at=datetime.now(),
            )

        # Get all tasks that had work done with eager loading
        task_ids = list({log.task_id for log in work_logs})

        tasks_query = (
            select(Task)
            .options(selectinload(Task.goal).selectinload(Goal.project))
            .join(Goal, Task.goal_id == Goal.id)
            .join(Project, Goal.project_id == Project.id)
            .where(and_(Task.id.in_(task_ids), Project.owner_id == user_id))
        )
        tasks = session.exec(tasks_query).all()

        # Relationships are already loaded via eager loading, no need for manual loading

        # Get unique projects from already loaded task relationships
        project_dict = {}
        for task in tasks:
            if task.goal and task.goal.project:
                project_dict[task.goal.project.id] = task.goal.project
        projects = list(project_dict.values())

        # Calculate summaries
        work_summary = self._calculate_weekly_summary(work_logs, tasks, start_date)
        project_summaries = [
            self._calculate_project_progress(project, tasks, work_logs)
            for project in projects
        ]

        # Generate markdown report with AI
        markdown_report = self._generate_markdown_report_with_ai(
            openai_api_key,
            request.week_start_date,
            work_summary,
            project_summaries,
            openai_model,
        )

        return WeeklyReportResponse(
            week_start_date=request.week_start_date,
            week_end_date=(start_date + timedelta(days=6)).strftime("%Y-%m-%d"),
            work_summary=work_summary,
            project_summaries=project_summaries,
            markdown_report=markdown_report,
            generated_at=datetime.now(),
        )
