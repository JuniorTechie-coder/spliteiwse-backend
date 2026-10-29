
type MemberBalance = {
    user_id: number;
    username: string;
    net_balance_paise: number;
};

type SettlementSuggestion = {
    from_user_id: number;
    from_username: string;
    to_user_id: number;
    to_username: string;
    amount_paise: number;
};

export function calculateSettlements(balances: MemberBalance[]): SettlementSuggestion[] {
    //validation to check if balances is empty
    if (balances.length === 0) {
        return [];
    }
    //validation to check if the user's net balance has grown so large or negative
    const hasInvalidBalance = balances.some(
        (balance) => !Number.isSafeInteger(balance.net_balance_paise)
    );

    if (hasInvalidBalance) {
        throw new Error("Every net balance must be a safe integer");
    }


     //Input userId and username  validation 
    const hasInvalidMember = balances.some(
        (balance) =>
            !Number.isSafeInteger(balance.user_id) ||
            balance.user_id <= 0 ||
            typeof balance.username !== "string" ||
            balance.username.trim().length === 0
    );

    if (hasInvalidMember) {
        throw new Error(
            "Every member must have a positive safe user ID and a non-empty username"
        );
    }

    //Added the duplicate userId validation 
    const uniqueUserIds = new Set(
        balances.map((balance) => balance.user_id)
    );

    if (uniqueUserIds.size !== balances.length) {
        throw new Error("Duplicate user IDs are not allowed");
    }

   

    //Validation to check the total net_balance is zero or not
     const totalNetBalance = balances.reduce(
        (sum, balance) => sum + balance.net_balance_paise,
        0
     );

     if(totalNetBalance !== 0){
        throw new Error(
            "Total net balance must equal zero"
    );
}

    
   // user who has to pay 
    const debtors = balances.filter((balance) => {
      return balance.net_balance_paise < 0 ;
    });

   //users who should receive money.
    const creditors = balances.filter((balance) => {
       return balance.net_balance_paise > 0;
    });

    const settlements: SettlementSuggestion[] = [];


    //It converts negative amounts to positive amounts
    const remainingDebtors = debtors.map((debtor) => ({
        ...debtor, 
        remaining_amount_paise: Math.abs(debtor.net_balance_paise),
    }));

    const remainingCreditors = creditors.map((creditor) => ({
        ...creditor, 
        remaining_amount_paise: Math.abs(creditor.net_balance_paise), 
    }));


    let debtorIndex = 0;
    let creditorIndex = 0;

    while(
        debtorIndex < remainingDebtors.length &&
        creditorIndex < remainingCreditors.length
    ) {
         const debtor = remainingDebtors[debtorIndex];
         const creditor = remainingCreditors[creditorIndex];


         if(!debtor || !creditor){
            break;
         }
 
         //The algorithm compares the current debtor and creditor:
        const paymentAmount = Math.min(
           debtor.remaining_amount_paise,
           creditor.remaining_amount_paise
        );

      //the amount_paise is the amount must be paid by debtor to creditor
        settlements.push({
            from_user_id: debtor.user_id,
             from_username: debtor.username,
             to_user_id: creditor.user_id,
             to_username: creditor.username,
             amount_paise: paymentAmount,
        });

     debtor.remaining_amount_paise -= paymentAmount;
     creditor.remaining_amount_paise -= paymentAmount;

     if(debtor.remaining_amount_paise === 0){
        debtorIndex++;
     }

     if(creditor.remaining_amount_paise === 0){
        creditorIndex++;
     }
}


    return settlements;
}
