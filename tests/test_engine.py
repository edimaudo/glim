import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tempfile
from pathlib import Path
from app.services import DB, compute_daily_drip, build_plan, seed_persona, choose_split
from app.data import PERSONAS


def test_daily_drip_is_bounded_by_goal_and_floor():
    p = {"monthly_income": 5200, "savings_pct": 5, "average_monthly_expenses": 3900, "floor_balance": 1000}
    assert compute_daily_drip(p) == 8.67


def test_plan_is_deterministic():
    with tempfile.TemporaryDirectory() as td:
        db=DB(str(Path(td)/'x.db'))
        p=PERSONAS['riley']
        seed_persona(db,p.__dict__,p.average_monthly_expenses)
        a=build_plan(db,'avalanche',65)
        b=build_plan(db,'avalanche',65)
        assert a==b


def test_stash_first_split_before_shield():
    with tempfile.TemporaryDirectory() as td:
        db=DB(str(Path(td)/'x.db'))
        p=PERSONAS['riley']
        seed_persona(db,p.__dict__,p.average_monthly_expenses)
        s=__import__('app.services',fromlist=['get_state']).get_state(db)
        s['stash']['balance']=10
        __import__('app.services',fromlist=['write_state']).write_state(db,s)
        assert choose_split(s)==(65.0,35.0)


def test_approval_records_ledger_but_balances_wait_for_confirmed_settlement():
    with tempfile.TemporaryDirectory() as td:
        from app.services import approve_drip, get_state, write_state, _finalize_settlement_success, now_iso
        db=DB(str(Path(td)/'x.db'))
        p=PERSONAS['riley']
        seed_persona(db,p.__dict__,p.average_monthly_expenses)
        s=get_state(db)
        s['paypal']={'status':'connected','mode':'sandbox','country':'CA','currency':'CAD','scopes':[],'vault_id':'TEST-Vault'}
        write_state(db,s)
        before=get_state(db)
        get_debts = __import__('app.services',fromlist=['get_debts']).get_debts
        before_debt = get_debts(db)[0]['balance']
        result=approve_drip(db,True)
        after=get_state(db)
        assert result['status']=='approved'
        assert after['stash']['balance'] == before['stash']['balance'], 'approval is not proof of settlement'
        assert after['game']['points'] > before['game']['points']
        get_debts = __import__('app.services',fromlist=['get_debts']).get_debts
        assert get_debts(db)[0]['balance'] == before_debt
        with db.connect() as c:
            row=c.execute("SELECT * FROM ledger_entries WHERE id=?", (result['ledger_id'],)).fetchone()
            c.execute("INSERT INTO payment_settlements(reference,amount,stash_amount,debt_amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                      ('settlement-test',result['amount'],result['stash_share'],result['debt_share'],'payout_pending',now_iso(),now_iso()))
            c.execute("UPDATE ledger_entries SET status='settlement_pending',settlement_id='settlement-test' WHERE id=?", (result['ledger_id'],))
        assert _finalize_settlement_success(db,'settlement-test',source='test confirmation') is True
        confirmed=get_state(db)
        confirmed_debt = get_debts(db)[0]['balance']
        assert confirmed['stash']['balance'] == round(before['stash']['balance'] + result['stash_share'],2)
        assert round(confirmed_debt,2) == round(before_debt - result['debt_share'],2)
        assert _finalize_settlement_success(db,'settlement-test',source='duplicate confirmation') is False
        repeated=get_state(db)
        assert repeated['stash']['balance'] == confirmed['stash']['balance'], 'duplicate confirmation must not double-apply savings'
        assert round(get_debts(db)[0]['balance'],2) == round(confirmed_debt,2), 'duplicate confirmation must not double-apply debt payoff'


def test_daily_approval_is_idempotent():
    with tempfile.TemporaryDirectory() as td:
        from app.services import approve_drip, get_state, write_state
        db=DB(str(Path(td)/'x.db'))
        p=PERSONAS['riley']; seed_persona(db,p.__dict__,p.average_monthly_expenses)
        state=get_state(db); state['paypal']={'status':'connected','mode':'sandbox','vault_id':'test','scopes':[]}; write_state(db,state)
        before=get_state(db)['game']['points']
        first=approve_drip(db,True)
        second=approve_drip(db,True)
        assert first['status']=='approved'
        assert second['status']=='already_recorded'
        with db.connect() as c:
            assert c.execute("SELECT COUNT(*) FROM ledger_entries WHERE kind='drip'").fetchone()[0] == 1
        assert get_state(db)['game']['points'] == before + 20


def test_settlement_does_not_begin_without_paypal_credentials(monkeypatch, tmp_path):
    from app.services import approve_drip, get_state, write_state, settle_week
    monkeypatch.delenv('PAYPAL_CLIENT_ID', raising=False)
    monkeypatch.delenv('PAYPAL_CLIENT_SECRET', raising=False)
    db=DB(str(Path(tmp_path)/'preflight.db'))
    p=PERSONAS['riley']; seed_persona(db,p.__dict__,p.average_monthly_expenses)
    state=get_state(db); state['paypal']={'status':'connected','mode':'sandbox','vault_id':'test','scopes':[]}; write_state(db,state)
    row=approve_drip(db,True)
    try:
        settle_week(db)
        assert False, 'expected missing PayPal configuration to block settlement'
    except ValueError as exc:
        assert 'credentials are not configured' in str(exc)
    with db.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM payment_settlements").fetchone()[0] == 0
        ledger=c.execute("SELECT status FROM ledger_entries WHERE id=?",(row['ledger_id'],)).fetchone()
        assert ledger['status']=='accrued'


def test_pause_blocks_approval():
    with tempfile.TemporaryDirectory() as td:
        from app.services import approve_drip, get_state, write_state, PayPalSandbox
        db=DB(str(Path(td)/'x.db'))
        p=PERSONAS['riley']
        seed_persona(db,p.__dict__,p.average_monthly_expenses)
        s=__import__('app.services',fromlist=['get_state']).get_state(db)
        s['paypal']={'status':'connected','mode':'sandbox','country':'CA','currency':'CAD','scopes':[],'vault_id':'TEST-Vault'}
        __import__('app.services',fromlist=['write_state']).write_state(db,s)
        s=get_state(db); s['paused']=True; write_state(db,s)
        try:
            approve_drip(db,True)
            assert False, 'expected ValueError'
        except ValueError as e:
            assert 'paused' in str(e).lower()


def test_scout_does_not_invent_recurring_activity_without_paypal(monkeypatch, tmp_path):
    from app.services import run_scout
    monkeypatch.delenv('PAYPAL_CLIENT_ID', raising=False)
    monkeypatch.delenv('PAYPAL_CLIENT_SECRET', raising=False)
    db = DB(str(Path(tmp_path) / 'scout.db'))
    persona = PERSONAS['riley']
    seed_persona(db, persona.__dict__, persona.average_monthly_expenses)
    result = run_scout(db)
    assert result['subscriptions'] == []
    assert result['source'] == 'No connected PayPal activity'
