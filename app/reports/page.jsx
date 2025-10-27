'use client';
import SideBar from "@/components/SideBar/page";
import styles from "./styles.module.css";
import { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  getDoc,
  deleteDoc
} from "firebase/firestore";
import { db } from "@/app/firebase";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { useRouter } from "next/navigation";

function Reports() {
  const router = useRouter()
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [reports, setReports] = useState([]);
  const [displayedReports, setDisplayedReports] = useState([]); 
  const [totalAmount, setTotalAmount] = useState(0);
  const [masrofatList, setMasrofatList] = useState([]);
  const [expensesInRange, setExpensesInRange] = useState(0);
  const [profitInRange, setProfitInRange] = useState(0);
  const [searchPhone, setSearchPhone] = useState("");
  const [selectedReport, setSelectedReport] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [auth, setAuth] = useState(false)
  const [loading, setLoading] = useState(true)
  const shop = typeof window !== "undefined" ? localStorage.getItem("shop") : "";


  useEffect(() => {
    const checkLock = async() => {
      const userName = localStorage.getItem('userName')
      if(!userName) {
        router.push('/')
        return
      }
      const q = query(collection(db, 'users'), where('userName', '==', userName))
      const querySnapshot = await getDocs(q)
      if(!querySnapshot.empty) {
        const user = querySnapshot.docs[0].data()
        if(user.permissions?.reports === true) {
          alert('ليس ليدك الصلاحية للوصول الى هذه الصفحة❌')
          router.push('/')
          return
        }else {
          setAuth(true)
        }
      }else {
        router.push('/')
        return
      }
      setLoading(false)
    }
    checkLock()
  }, [])

  // Helper: convert Firestore timestamp or date-like to milliseconds
    // Helper: convert Firestore timestamp OR Arabic date string to milliseconds
  const toMillis = (dateField) => {
    if (!dateField) return null;

    // Firestore Timestamp object
    if (typeof dateField === "object" && dateField.seconds) {
      return dateField.seconds * 1000;
    }

    if (typeof dateField === "string") {
      try {
        // نحول الأرقام الهندية العربية إلى أرقام عادية
        const normalized = dateField.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
        // نقسم اليوم/الشهر/السنة
        const parts = normalized.split("/").map((p) => p.replace(/[^\d]/g, ""));
        if (parts.length === 3) {
          const [day, month, year] = parts.map(Number);
          const d = new Date(year, month - 1, day);
          if (!isNaN(d.getTime())) return d.getTime();
        }
      } catch {
        return null;
      }
    }

    // محاولة أخيرة مع Date مباشرة
    const d = new Date(dateField);
    return isNaN(d.getTime()) ? null : d.getTime();
  };


  // fetch all reports for the shop (we'll filter by date range locally)
  useEffect(() => {
    if (!shop) return;
    const q = query(collection(db, "reports"), where("shop", "==", shop));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allReports = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setReports(allReports);
    });
    return () => unsubscribe();
  }, [shop]);

  // fetch all masrofat for the shop (we'll filter by date range locally)
  useEffect(() => {
    if (!shop) return;
    const q = query(collection(db, "masrofat"), where("shop", "==", shop));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMasrofatList(all);
    });
    return () => unsubscribe();
  }, [shop]);

  // Whenever reports, fromDate, toDate, filterType or searchPhone change, compute displayedReports and totals
  useEffect(() => {
    // require both fromDate and toDate to show results (otherwise keep table empty)
    if (!fromDate || !toDate) {
      setDisplayedReports([]);
      setTotalAmount(0);
      setExpensesInRange(0);
      setProfitInRange(0);
      return;
    }

    // convert user input dates to milliseconds range (inclusive)
    // fromDate at 00:00:00, toDate at 23:59:59.999 local
    let from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    const fromMs = from.getTime();
    let to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    const toMs = to.getTime();

    // filter reports by date range
    let filtered = reports.filter((report) => {
      const repMs = toMillis(report.date);
      if (!repMs) return false;
      return repMs >= fromMs && repMs <= toMs;
    });

    // filter by searchPhone if provided
    if (searchPhone.trim()) {
      filtered = filtered.filter((r) => r.phone?.toString().includes(searchPhone.trim()));
    }

    // filter by type if needed (and ensure we only keep reports that still have cart items after filtering)
    filtered = filtered
      .map((report) => {
        if (filterType === "all") return report;
        return {
          ...report,
          cart: report.cart?.filter((item) => item.type === filterType) || [],
        };
      })
      .filter((report) => (report.cart?.length ?? 0) > 0);

    // compute totals and profit for displayed reports
    let totalSales = 0;
    let totalProfit = 0;

    filtered.forEach((report) => {
      // compute reportCartTotal (sum of sellPrice * qty)
      const cart = report.cart || [];
      const cartTotal = cart.reduce((s, it) => s + (Number(it.sellPrice || 0) * Number(it.quantity || 0)), 0);

      // use report.total if available, otherwise derive from cartTotal minus report.discount
      const reportTotal = Number(report.total ?? (cartTotal - (Number(report.discount || 0))));
      totalSales += reportTotal;

      // compute profit per report:
      // distribute discount proportionally across items (if any discount)
      let reportProfit = 0;
      const discountValue = Number(report.discount || 0);
      // avoid division by zero
      cart.forEach((it) => {
        const qty = Number(it.quantity || 0);
        const sell = Number(it.sellPrice || 0);
        const buy = Number(it.buyPrice ?? it.productPrice ?? 0);
        const itemGross = sell * qty;

        const itemDiscount = cartTotal > 0 ? (itemGross / cartTotal) * discountValue : 0;
        const itemNetRevenue = itemGross - itemDiscount;
        const itemProfit = itemNetRevenue - (buy * qty);
        reportProfit += itemProfit;
      });

      totalProfit += reportProfit;
    });

    // compute expenses in the same range from masrofatList
    const expenses = masrofatList.reduce((s, exp) => {
      const expMs = toMillis(exp.date);
      if (!expMs) return s;
      if (expMs >= fromMs && expMs <= toMs) {
        return s + (Number(exp.masrof || 0));
      }
      return s;
    }, 0);

    setDisplayedReports(filtered);
    setTotalAmount(totalSales);
    setExpensesInRange(expenses);
    setProfitInRange(totalProfit);
  }, [reports, masrofatList, fromDate, toDate, filterType, searchPhone]);

  // Excel export for displayedReports (behaves on current visible rows)
  const exportToExcel = async () => {
  if (!fromDate || !toDate) {
    alert("رجاءً اختر فترة (من - إلى) قبل التصدير");
    return;
  }

  const fromTime = new Date(fromDate).setHours(0, 0, 0, 0);
  const toTime = new Date(toDate).setHours(23, 59, 59, 999);

  const exportProducts = [];
  let totalSales = 0;
  let totalProfit = 0;

  // 🟦 1. المنتجات من التقارير (reports)
  displayedReports.forEach((report) => {
    report.cart?.forEach((item) => {
      const itemDate = new Date(report.date.seconds * 1000).getTime();
      if (itemDate >= fromTime && itemDate <= toTime) {
        const itemTotal = item.sellPrice * item.quantity;
        const itemProfit = (item.sellPrice - (item.buyPrice || 0)) * item.quantity;
        totalSales += itemTotal;
        totalProfit += itemProfit;

        exportProducts.push({
          "اسم المنتج": item.name,
          "الكمية": item.quantity,
          "سعر البيع": item.sellPrice,
          "سعر الشراء": item.buyPrice,
          "الربح": itemProfit,
          "الخصم": report.discount ?? 0,
          "اسم العميل": report.clientName,
          "رقم الهاتف": report.phone,
          "الموظف": report.employee,
          "المحل": report.shop,
          "التاريخ": new Date(report.date.seconds * 1000).toLocaleDateString("ar-EG"),
        });
      }
    });
  });

  // 🟨 2. المصروفات من masrofat
  const expensesSnapshot = await getDocs(collection(db, "masrofat"));
  const exportExpenses = [];
  let totalExpenses = 0;

  expensesSnapshot.forEach((docSnap) => {
    const exp = docSnap.data();
    const dateStr = exp.date;
    if (!dateStr) return;

    // تحويل التاريخ العربي إن وجد
    const normalized = dateStr.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
    const parts = normalized.split("/").map((p) => p.replace(/[^\d]/g, ""));
    if (parts.length === 3) {
      const [day, month, year] = parts.map(Number);
      const expTime = new Date(year, month - 1, day).getTime();
      if (expTime >= fromTime && expTime <= toTime) {
        totalExpenses += Number(exp.masrof) || 0;
        exportExpenses.push({
          "البيان": exp.reason || "-",
          "القيمة": exp.masrof || 0,
          "التاريخ": exp.date,
          "المحل": exp.shop || "-",
        });
      }
    }
  });

  // 🟥 3. الديون من debts
  const debtsSnapshot = await getDocs(collection(db, "debts"));
  const exportDebts = [];
  debtsSnapshot.forEach((docSnap) => {
    const debt = docSnap.data();
    const debtDate = debt.date?.seconds ? new Date(debt.date.seconds * 1000) : null;
    if (!debtDate) return;
    const debtTime = debtDate.getTime();
    if (debtTime >= fromTime && debtTime <= toTime) {
      exportDebts.push({
        "اسم العميل": debt.clientName,
        "المبلغ": debt.amount,
        "التاريخ": debtDate.toLocaleDateString("ar-EG"),
        "المحل": debt.shop || "-",
        "ملاحظات": debt.notes || "-",
      });
    }
  });

  // 🟩 4. ملخص الإجماليات
  const summaryData = [
    { البند: "إجمالي المبيعات", القيمة: totalSales },
    { البند: "إجمالي المصروفات", القيمة: totalExpenses },
    { البند: "إجمالي الربح", القيمة: totalProfit },
    { البند: "صافي الربح", القيمة: totalProfit - totalExpenses },
  ];

  // 🧾 إنشاء الملف Excel
  const workbook = XLSX.utils.book_new();

  // إنشاء الشيتات
  const sheetProducts = XLSX.utils.json_to_sheet(exportProducts);
  const sheetExpenses = XLSX.utils.json_to_sheet(exportExpenses);
  const sheetDebts = XLSX.utils.json_to_sheet(exportDebts);
  const sheetSummary = XLSX.utils.json_to_sheet(summaryData);

  // إضافتها للملف
  XLSX.utils.book_append_sheet(workbook, sheetProducts, "Products");
  XLSX.utils.book_append_sheet(workbook, sheetExpenses, "Expenses");
  XLSX.utils.book_append_sheet(workbook, sheetDebts, "Debts");
  XLSX.utils.book_append_sheet(workbook, sheetSummary, "Summary");

  // تصدير الملف
  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const data = new Blob([excelBuffer], { type: "application/octet-stream" });
  saveAs(data, `Reports_${new Date().toLocaleDateString("ar-EG")}.xlsx`);

  alert("✅ تم تصدير الملف بنجاح!");
};


  // Drawer open/close
  const openDrawer = (report) => {
    setSelectedReport(report);
    setIsDrawerOpen(true);
  };
  const closeDrawer = () => {
    setSelectedReport(null);
    setIsDrawerOpen(false);
  };

  // return product (same logic you had, adapted to reports collection)
const handleReturnProduct = async (item) => {
  try {
    const productQuery = query(
      collection(db, "lacosteProducts"),
      where("code", "==", item.code)
    );
    const querySnapshot = await getDocs(productQuery);

    if (!querySnapshot.empty) {
      const prodRef = querySnapshot.docs[0].ref;
      const prodData = querySnapshot.docs[0].data();

      let newColors = prodData.colors || [];
      let newSizes = prodData.sizes || [];

      // ✅ تعديل كمية اللون لو فيه ألوان
      if (Array.isArray(newColors) && item.color) {
        newColors = newColors.map((c) =>
          c.color === item.color
            ? { ...c, quantity: Number(c.quantity || 0) + Number(item.quantity || 1) }
            : c
        );
      }

      // ✅ تعديل كمية المقاس لو فيه مقاسات
      if (Array.isArray(newSizes) && item.size) {
        newSizes = newSizes.map((s) =>
          s.size === item.size
            ? { ...s, quantity: Number(s.quantity || 0) + Number(item.quantity || 1) }
            : s
        );
      }

      // ✅ حساب الكمية الإجمالية الجديدة بعد التعديل
      const computeNewTotalQuantity = (colors, sizes, baseQty = 0) => {
        let total = baseQty;
        if (Array.isArray(colors)) {
          total = colors.reduce((sum, c) => sum + Number(c.quantity || 0), 0);
        }
        if (Array.isArray(sizes)) {
          total = sizes.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
        }
        return total;
      };

      const newTotalQty = computeNewTotalQuantity(
        newColors,
        newSizes,
        Number(prodData.quantity || 0)
      );

      const updateObj = { quantity: newTotalQty };
      if (newColors) updateObj.colors = newColors;
      if (newSizes) updateObj.sizes = newSizes;

      await updateDoc(prodRef, updateObj);

      // 🟢 حذف المنتج من reports بعد المرتجع
      const reportsSnapshot = await getDocs(collection(db, "reports"));
      for (const reportDoc of reportsSnapshot.docs) {
        const reportData = reportDoc.data();
        const cart = reportData.cart || [];

        // لو الفاتورة تحتوي على المنتج ده
        const updatedCart = cart.filter((prod) => prod.code !== item.code);

        // لو الكارت اتغير (يعني المنتج فعلاً كان موجود واتشال)
        if (updatedCart.length !== cart.length) {
          if (updatedCart.length === 0) {
            // 🔴 لو مفيش منتجات بعد الحذف → احذف الفاتورة كلها
            await deleteDoc(reportDoc.ref);
            console.log(`تم حذف الفاتورة الفارغة: ${reportDoc.id}`);
          } else {
            // ✅ غير كده حدث الفاتورة بدون المنتج ده
            await updateDoc(reportDoc.ref, { cart: updatedCart });
            console.log(`تم حذف المنتج ${item.code} من الفاتورة ${reportDoc.id}`);
          }
        }
      }

      alert("تم إرجاع المنتج وتحديث الكميات وحذف المنتج من الفاتورة بنجاح ✅");
    } else {
      alert("المنتج غير موجود ❌");
    }
  } catch (error) {
    console.error("حدث خطأ أثناء المرتجع:", error);
    alert("حدث خطأ أثناء المرتجع ❌");
  }
};


  if (loading) return <p>🔄 جاري التحقق...</p>;
  if (!auth) return null;

  return (
    <div className={styles.reports}>
      <SideBar />

      {/* المحتوى الرئيسي */}
      <div className={styles.content}>
        {/* فلتر التاريخ / نوع / بحث */}
        <div className={styles.filterBar}>
          <div className={styles.inputBox}>
            <div className="inputContainer">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="inputContainer">
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.inputBox}>
            <div className="inputContainer">
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="all">الكل</option>
                <option value="product">المنتجات</option>
                <option value="phone">الموبايلات</option>
              </select>
            </div>
            <div className="inputContainer">
              <input
                type="text"
                placeholder="بحث برقم العميل"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* كروت الملخص الثلاثة */}
        <div className={styles.salesContainer}>
            <div className={styles.cardsContainer}>
                <div className={styles.card}>
                    <h4>إجمالي المبيعات</h4>
                    <p>{totalAmount} جنيه</p>
                </div>
                <div className={styles.card}>
                    <h4>المصروفات</h4>
                    <p>{expensesInRange} جنيه</p>
                </div>
                <div className={styles.card}>
                    <h4>الربح</h4>
                    <p>{profitInRange} جنيه</p>
                </div>
            </div>
        </div>

        {/* زر تصدير (يعمل فقط لو في فترة محددة) */}
        <div>
          <button className={styles.exeBtn} onClick={exportToExcel}>تصدير Excel</button>
        </div>

        {/* إذا المستخدم لم يحدد فترة، نعرض رسالة */}
          <div className={styles.tableContainer}>
            <table>
              <thead>
                <tr>
                  <th>اسم العميل</th>
                  <th>رقم الهاتف</th>
                  <th>عدد العناصر</th>
                  <th>الإجمالي</th>
                  <th>التاريخ</th>
                  <th>عرض التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {displayedReports.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 20 }}>
                      لا توجد تقارير في الفترة المحددة.
                    </td>
                  </tr>
                ) : (
                  displayedReports.map((report) => {
                    const total = Number(report.total ?? report.subtotal ?? 0);
                    return (
                      <tr key={report.id}>
                        <td>{report.clientName || "-"}</td>
                        <td>{report.phone || "-"}</td>
                        <td>{report.cart?.length || 0}</td>
                        <td>{total} EGP</td>
                        <td>
                          {report.date
                            ? new Date(report.date.seconds * 1000).toLocaleDateString("ar-EG")
                            : "-"}
                        </td>
                        <td>
                          <button
                            className={styles.detailsBtn}
                            onClick={() => openDrawer(report)}
                          >
                            عرض التفاصيل
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
      </div>

      {/* القسم الجانبي (Drawer) لتفاصيل التقرير */}
      {isDrawerOpen && selectedReport && (
        <div className={styles.invoiceSidebar}>
          <div className={styles.sidebarHeader}>
            <h3>تفاصيل التقرير</h3>
            <button onClick={closeDrawer}>إغلاق</button>
          </div>

          <div className={styles.sidebarInfo}>
            <p><strong>اسم العميل:</strong> {selectedReport.clientName}</p>
            <p><strong>رقم الهاتف:</strong> {selectedReport.phone}</p>
            <p><strong>الموظف:</strong> {selectedReport.employee || "-"}</p>
            <p><strong>التاريخ:</strong> {selectedReport.date ? new Date(selectedReport.date.seconds * 1000).toLocaleString("ar-EG") : "-"}</p>
            <p><strong>الخصم :</strong> {selectedReport.discount ?? 0}</p>
            <p><strong>ملاحظات :</strong> {selectedReport.discountNotes ?? "-"}</p>
            <p><strong>الربح (حسب التقرير):</strong> {selectedReport.profit ?? "-"}</p>
          </div>

          <div className={styles.sidebarProducts}>
            <h5>المنتجات</h5>
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>السعر</th>
                  <th>الكمية</th>
                  <th>الحالة</th>
                  <th>السريال</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {selectedReport.cart?.map((item, index) => (
                  <tr key={index}>
                    <td>{item.name}</td>
                    <td>{item.sellPrice}</td>
                    <td>{item.quantity}</td>
                    <td>{item.condition || "-"}</td>
                    <td>{item.serial || "-"}</td>
                    <td>
                      <button className={styles.returnBtn} onClick={() => handleReturnProduct(item, selectedReport.id)}>
                        مرتجع
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}
    </div>
  );
}

export default Reports;
