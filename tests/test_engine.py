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


def test_approval_reduces_boss_and_accumulates_stash():
    with tempfile.TemporaryDirectory() as td:
        from app.services import approve_drip, get_state, PayPalSandbox
        db=DB(str(Path(td)/'x.db'))
        p=PERSONAS['riley']
        seed_persona(db,p.__dict__,p.average_monthly_expenses)
        s=__import__('app.services',fromlist=['get_state']).get_state(db)
        s['paypal']={'status':'connected','mode':'sandbox','country':'CA','currency':'CAD','scopes':[],'vault_id':'TEST-Vault'}
        __import__('app.services',fromlist=['write_state']).write_state(db,s)
        before=get_state(db)['stash']['balance']
        result=approve_drip(db,True)
        after=get_state(db)
        assert result['status']=='approved'
        assert after['stash']['balance'] > before
        assert after['stash']['balance'] == round(before + result['stash_share'],2)
        assert after['game']['points'] > 180


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
