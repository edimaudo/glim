from app import main


def test_hourly_job_includes_finite_monthly_savings_schedule(monkeypatch):
    calls = []
    for name in (
        "auto_drip_tick",
        "scheduled_nudge_tick",
        "process_monthly_auto_deposit_if_due",
        "weekly_settlement_tick",
        "reconcile_stale_settlements",
    ):
        monkeypatch.setattr(main, name, lambda *args, _name=name, **kwargs: calls.append(_name))

    main.run_tenant_scheduled_jobs(object(), email="user@example.test", shared_db=object())

    assert calls == [
        "auto_drip_tick",
        "scheduled_nudge_tick",
        "process_monthly_auto_deposit_if_due",
        "weekly_settlement_tick",
        "reconcile_stale_settlements",
    ]
