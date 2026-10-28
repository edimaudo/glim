import math
import pytest
from services.financial_products import compare_product_terms


def test_savings_comparison_ranks_highest_net_value_first():
    result = compare_product_terms("savings", 1000, [
        {"name": "Higher rate", "annual_rate": 4.0, "annual_fee": 0},
        {"name": "Lower rate", "annual_rate": 2.0, "annual_fee": 0},
    ])
    assert result["products"][0]["name"] == "Higher rate"
    assert result["products"][0]["estimated_annual_value"] == 40


def test_borrowing_comparison_ranks_lowest_estimated_cost_first():
    result = compare_product_terms("credit_card", 1000, [
        {"name": "High rate", "annual_rate": 19.99, "annual_fee": 0},
        {"name": "Lower rate", "annual_rate": 12.99, "annual_fee": 50},
    ])
    assert result["products"][0]["name"] == "Lower rate"
    assert result["products"][0]["estimated_annual_value"] < result["products"][1]["estimated_annual_value"]


def test_comparison_rejects_nan_and_infinite_inputs():
    with pytest.raises(ValueError, match="finite"):
        compare_product_terms("savings", math.nan, [{"name": "A"}, {"name": "B"}])
    with pytest.raises(ValueError, match="finite"):
        compare_product_terms("savings", 100, [{"name": "A", "annual_rate": math.inf}, {"name": "B", "annual_rate": 1}])


def test_unsupported_category_is_rejected():
    with pytest.raises(ValueError, match="Choose savings"):
        compare_product_terms("investment", 100, [{"name": "A"}, {"name": "B"}])
